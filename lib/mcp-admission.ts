/** Local overload protection only. Each Worker isolate has independent counters. */
export type McpAdmissionLimits = {
  bodies: number;
  tools: number;
  perAccount: number;
  heavyReads: number;
  bodyTimeoutMs: number;
};
export const defaultMcpAdmissionLimits: Readonly<McpAdmissionLimits> = Object.freeze({
  bodies: 16, tools: 12, perAccount: 3, heavyReads: 2, bodyTimeoutMs: 5000,
});
type Release = () => void;

export class McpAdmission {
  readonly limits: Readonly<McpAdmissionLimits>;
  private bodies = 0;
  private tools = 0;
  private heavyReads = 0;
  private accounts = new Map<string, number>();

  constructor(limits: Partial<McpAdmissionLimits> = {}) {
    const merged = { ...defaultMcpAdmissionLimits, ...limits };
    for (const value of Object.values(merged)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Admission limits must be positive integers.');
    }
    this.limits = Object.freeze(merged);
  }

  private once(release: Release): Release {
    let active = true;
    return () => { if (active) { active = false; release(); } };
  }

  claimBody(): Release | null {
    if (this.bodies >= this.limits.bodies) return null;
    this.bodies++;
    return this.once(() => { this.bodies--; });
  }

  claimTool(heavy: boolean): Release | null {
    if (this.tools >= this.limits.tools || heavy && this.heavyReads >= this.limits.heavyReads) return null;
    this.tools++; if (heavy) this.heavyReads++;
    return this.once(() => { this.tools--; if (heavy) this.heavyReads--; });
  }

  claimAccount(accountId: string): Release | null {
    const count = this.accounts.get(accountId) || 0;
    if (count >= this.limits.perAccount) return null;
    this.accounts.set(accountId, count + 1);
    return this.once(() => {
      const remaining = this.accounts.get(accountId)! - 1;
      if (remaining) this.accounts.set(accountId, remaining); else this.accounts.delete(accountId);
    });
  }

  // Aggregate local diagnostics; no identities, retained idle entries or request contents.
  get usage() { return { bodies: this.bodies, tools: this.tools, heavyReads: this.heavyReads, accounts: this.accounts.size }; }
}

export const mcpAdmission = new McpAdmission();

export function isHeavyMcpRead(name: string, args: Record<string, unknown>) {
  return ['read_context', 'read_task', 'read_context_change', 'list_spaces', 'list_sessions'].includes(name)
    || name === 'read_inbox' && args.projection !== 'summary';
}
