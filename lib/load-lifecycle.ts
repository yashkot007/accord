type LoadCallbacks<T> = {
  start: () => void;
  success: (value: T) => void;
  failure: (error: unknown) => void;
  finish: () => void;
};

/** One explicit load per mounted lifecycle. Nothing is queued or replayed. */
export class LoadLifecycle {
  private active = false;
  private revision = 0;
  private pending = false;

  activate() { this.active = true; this.revision++; this.pending = false; }
  deactivate() { this.active = false; this.revision++; this.pending = false; }
  invalidate() { this.revision++; this.pending = false; }

  current() {
    const revision = this.revision;
    return () => this.active && this.revision === revision;
  }

  async load<T>(request: () => Promise<T>, callbacks: LoadCallbacks<T>): Promise<'applied' | 'ignored' | 'pending'> {
    if (!this.active) return 'ignored';
    if (this.pending) return 'pending';
    this.pending = true;
    const current = this.current();
    try {
      callbacks.start();
      const value = await request();
      if (!current()) return 'ignored';
      callbacks.success(value);
      return 'applied';
    } catch (error) {
      if (!current()) return 'ignored';
      callbacks.failure(error);
      return 'applied';
    } finally {
      if (current()) {
        this.pending = false;
        callbacks.finish();
      }
    }
  }
}
