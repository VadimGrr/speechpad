import type { RestartReason } from './types.js';

export interface PlannerOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  minRestartGapMs: number;
  silentEndLimit: number;
  silentEndDelayMs: number;
}

export interface RestartDecision {
  action: 'restart';
  delayMs: number;
  attempt: number;
}

export type PlannerAction = RestartDecision | { action: 'stop' };

export class RestartPlanner {
  private attempt = 0;
  private silentRun = 0;
  private lastRestartAt = 0;

  constructor(private readonly options: PlannerOptions) {}

  get currentAttempt(): number {
    return this.attempt;
  }

  get currentSilentRun(): number {
    return this.silentRun;
  }

  reset(): void {
    this.attempt = 0;
    this.silentRun = 0;
    this.lastRestartAt = 0;
  }

  noteResult(): void {
    this.silentRun = 0;
    this.attempt = 0;
  }

  decide(input: {
    now: number;
    wantRecord: boolean;
    hadResult: boolean;
    reason: RestartReason;
  }): PlannerAction {
    if (!input.wantRecord) return { action: 'stop' };

    if (input.hadResult) {
      this.silentRun = 0;
    } else {
      this.silentRun += 1;
    }
    this.attempt += 1;

    const sinceLast = input.now - this.lastRestartAt;
    if (this.lastRestartAt > 0 && sinceLast < this.options.minRestartGapMs) {
      const wait = this.options.minRestartGapMs - sinceLast;
      this.lastRestartAt = input.now + wait;
      return {
        action: 'restart',
        delayMs: wait,
        attempt: this.attempt,
      };
    }

    const backoff = Math.min(
      this.options.baseDelayMs * 2 ** (this.attempt - 1),
      this.options.maxDelayMs,
    );
    const delayMs =
      this.silentRun >= this.options.silentEndLimit
        ? this.options.silentEndDelayMs
        : backoff;

    this.lastRestartAt = input.now + delayMs;
    return { action: 'restart', delayMs, attempt: this.attempt };
  }
}

export function watchdogThreshold(
  baseMs: number,
  streak: number,
  maxMs: number,
): number {
  const factor = 2 ** Math.max(0, streak);
  return Math.min(baseMs * factor, maxMs);
}
