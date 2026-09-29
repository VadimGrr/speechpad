export type TimerId = number;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
  setInterval(fn: () => void, ms: number): TimerId;
  clearInterval(id: TimerId): void;
}

interface TimerGlobals {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const timers = globalThis as unknown as TimerGlobals;

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => timers.setTimeout(fn, ms) as TimerId,
  clearTimeout: (id) => timers.clearTimeout(id),
  setInterval: (fn, ms) => timers.setInterval(fn, ms) as TimerId,
  clearInterval: (id) => timers.clearInterval(id),
};
