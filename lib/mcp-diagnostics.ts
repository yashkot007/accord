import { agentTools } from './agent-tools.ts';

export const mcpReferenceHeader = 'X-Accord-Request-Reference';
const methods = ['initialize', 'ping', 'tools/list', 'tools/call', 'notification', 'other'] as const;
const tools = new Set(agentTools.map(tool => tool.name));
const outcomes = ['success', 'notification', 'transport_error', 'tool_error'] as const;
const reasons = ['invalid_request', 'overload', 'timeout', 'interrupted', 'authentication', 'access_denied', 'conflict', 'not_found', 'service_unavailable', 'unexpected_failure', 'other_application_error'] as const;
const phases = ['headers', 'body', 'validate', 'admission', 'auth', 'tool', 'serialize'] as const;
const timedPhases = ['body', 'auth', 'tool', 'serialize'] as const;
type Outcome = typeof outcomes[number];
type Reason = typeof reasons[number];
type Phase = typeof phases[number];
type TimedPhase = typeof timedPhases[number];
type AdmissionStage = 'body' | 'tool' | 'account';
type Category = 'success' | 'failure' | 'overload';
type Counters = Record<Outcome, number>;
type Timings = Partial<Record<TimedPhase, number>>;
type Completion = {
  event: 'accord.mcp.completed'; version: 1; reference: string | null;
  method: typeof methods[number]; tool: string | null; outcome: Outcome;
  status: number; application_status: number | null; reason: Reason | null;
  failure_phase: Phase | null; admission_stage: AdmissionStage | null;
  duration_ms: number; timings_ms: Timings;
};
type Summary = {
  event: 'accord.mcp.summary'; version: 1; window_ms: number; completed: number;
  outcomes: Counters; admission_rejections: Record<AdmissionStage, number>;
  samples: Record<Category, number>; suppressed: number;
  duration_ms: { total: number; max: number };
};
export type McpDiagnosticEvent = Completion | Summary;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (value: number) => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
const elapsed = (start: number, end: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(end - start)));
const emptyOutcomes = (): Counters => ({ success: 0, notification: 0, transport_error: 0, tool_error: 0 });
const defaultSink = (event: McpDiagnosticEvent) => {
  const text = JSON.stringify(event);
  if (event.event === 'accord.mcp.completed' && ['service_unavailable', 'unexpected_failure'].includes(event.reason || '')) console.error(text);
  else console.info(text);
};

/** Best-effort, isolate-local diagnostics with a synchronous sink. No identities,
 * dynamic key registry or timers; an idle/terminated isolate can lose its summary.
 * Timings use the runtime's observed clock, not a CPU or database-only measure. */
export class McpDiagnostics {
  private readonly clock: () => number;
  private readonly reference: () => string;
  private readonly sink: (event: McpDiagnosticEvent) => void;
  private readonly bucketMs: number;
  private readonly caps: Readonly<Record<Category, number>>;
  private lastClock = 0;
  private bucketStarted: number | null = null;
  private completed = 0;
  private outcomes = emptyOutcomes();
  private admission = { body: 0, tool: 0, account: 0 };
  private samples = { success: 0, failure: 0, overload: 0 };
  private suppressed = 0;
  private durationTotal = 0;
  private durationMax = 0;

  constructor(options: { clock?: () => number; reference?: () => string; sink?: (event: McpDiagnosticEvent) => void; bucketMs?: number; successSamples?: number; failureSamples?: number; overloadSamples?: number } = {}) {
    this.clock = options.clock || (() => performance.now());
    this.reference = options.reference || (() => crypto.randomUUID());
    this.sink = options.sink || defaultSink;
    this.bucketMs = options.bucketMs ?? 60_000;
    this.caps = Object.freeze({ success: options.successSamples ?? 2, failure: options.failureSamples ?? 8, overload: options.overloadSamples ?? 4 });
    if (!Number.isSafeInteger(this.bucketMs) || this.bucketMs < 1 || Object.values(this.caps).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100)) throw new RangeError('Choose bounded diagnostic windows and sample limits.');
  }

  now() {
    try {
      const value = this.clock();
      if (Number.isFinite(value)) this.lastClock = Math.max(this.lastClock, Math.min(Number.MAX_SAFE_INTEGER, value));
    } catch { /* A broken diagnostic clock must not affect a request. */ }
    return this.lastClock;
  }

  begin() {
    let reference: string | null = null;
    try { const value = this.reference(); if (typeof value === 'string' && uuid.test(value)) reference = value; } catch { /* Omit rather than fabricate a reference. */ }
    return new McpRequestDiagnostic(this, this.now(), reference);
  }

  private emit(event: McpDiagnosticEvent) {
    try { this.sink(event); } catch { /* Logging cannot alter a response or durable work. */ }
  }

  record(event: Completion) {
    const now = this.now();
    if (this.bucketStarted !== null && now - this.bucketStarted >= this.bucketMs) {
      this.emit({ event: 'accord.mcp.summary', version: 1, window_ms: elapsed(this.bucketStarted, now), completed: this.completed, outcomes: { ...this.outcomes }, admission_rejections: { ...this.admission }, samples: { ...this.samples }, suppressed: this.suppressed, duration_ms: { total: this.durationTotal, max: this.durationMax } });
      this.bucketStarted = now; this.completed = 0; this.outcomes = emptyOutcomes(); this.admission = { body: 0, tool: 0, account: 0 }; this.samples = { success: 0, failure: 0, overload: 0 }; this.suppressed = 0; this.durationTotal = 0; this.durationMax = 0;
    }
    if (this.bucketStarted === null) this.bucketStarted = now;
    this.completed = count(this.completed); this.outcomes[event.outcome] = count(this.outcomes[event.outcome]);
    if (event.admission_stage) this.admission[event.admission_stage] = count(this.admission[event.admission_stage]);
    this.durationTotal = Math.min(Number.MAX_SAFE_INTEGER, this.durationTotal + event.duration_ms); this.durationMax = Math.max(this.durationMax, event.duration_ms);
    const category: Category = event.reason === 'overload' ? 'overload' : ['success', 'notification'].includes(event.outcome) ? 'success' : 'failure';
    if (this.samples[category] >= this.caps[category]) { this.suppressed = count(this.suppressed); return; }
    this.samples[category]++; this.emit(event);
  }

  get snapshot() { return { completed: this.completed, outcomes: { ...this.outcomes }, admission_rejections: { ...this.admission }, samples: { ...this.samples }, suppressed: this.suppressed }; }
}

class McpRequestDiagnostic {
  private readonly started: number;
  private readonly reference: string | null;
  private readonly diagnostics: McpDiagnostics;
  private method: Completion['method'] = 'other';
  private tool: string | null = null;
  private phaseValue: Phase = 'headers';
  private phaseStarted: number;
  private timings: Timings = {};
  private outcome: Outcome = 'transport_error';
  private reason: Reason | null = 'unexpected_failure';
  private applicationStatus: number | null = null;
  private failurePhase: Phase | null = 'headers';
  private admissionStage: AdmissionStage | null = null;
  private finished = false;

  constructor(diagnostics: McpDiagnostics, started: number, reference: string | null) { this.diagnostics = diagnostics; this.started = started; this.phaseStarted = started; this.reference = reference; }
  select(method: string, tool?: string) {
    this.method = methods.includes(method as Completion['method']) ? method as Completion['method'] : 'other';
    this.tool = typeof tool === 'string' && tools.has(tool) ? tool : null;
  }
  phase(value: Phase) {
    if (!phases.includes(value)) return;
    const now = this.diagnostics.now();
    if (timedPhases.includes(this.phaseValue as TimedPhase)) {
      const key = this.phaseValue as TimedPhase;
      this.timings[key] = Math.min(Number.MAX_SAFE_INTEGER, (this.timings[key] || 0) + elapsed(this.phaseStarted, now));
    }
    this.phaseValue = value; this.phaseStarted = now;
  }
  result(outcome: Outcome, reason: Reason | null = null, applicationStatus: number | null = null, admissionStage: AdmissionStage | null = null) {
    this.outcome = outcomes.includes(outcome) ? outcome : 'transport_error';
    this.reason = reason === null || reasons.includes(reason) ? reason : 'unexpected_failure';
    this.applicationStatus = Number.isInteger(applicationStatus) && applicationStatus! >= 100 && applicationStatus! <= 599 ? applicationStatus : null;
    this.failurePhase = ['success', 'notification'].includes(this.outcome) ? null : this.phaseValue;
    this.admissionStage = admissionStage && ['body', 'tool', 'account'].includes(admissionStage) ? admissionStage : null;
  }
  finish(response?: Response) {
    if (this.finished) return; this.finished = true;
    this.phase(this.phaseValue);
    if (response && this.reference) { try { response.headers.set(mcpReferenceHeader, this.reference); } catch { /* Immutable/broken headers must not change a response. */ } }
    this.diagnostics.record({ event: 'accord.mcp.completed', version: 1, reference: this.reference, method: this.method, tool: this.tool, outcome: this.outcome, status: response?.status || 0, application_status: this.applicationStatus, reason: this.reason, failure_phase: this.failurePhase, admission_stage: this.admissionStage, duration_ms: elapsed(this.started, this.diagnostics.now()), timings_ms: { ...this.timings } });
  }
}

export const mcpDiagnostics = new McpDiagnostics();
export type { Outcome as McpDiagnosticOutcome, Reason as McpDiagnosticReason };
