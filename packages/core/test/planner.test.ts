import { describe, expect, it } from 'vitest';
import { RestartPlanner, watchdogThreshold } from '../src/planner.js';

const options = {
  baseDelayMs: 400,
  maxDelayMs: 3000,
  minRestartGapMs: 300,
  silentEndLimit: 3,
  silentEndDelayMs: 1500,
};

describe('RestartPlanner', () => {
  it('stops when the user no longer wants to record', () => {
    const planner = new RestartPlanner(options);
    expect(
      planner.decide({ now: 0, wantRecord: false, hadResult: true, reason: 'end' }),
    ).toEqual({ action: 'stop' });
  });

  it('grows the delay exponentially and caps it when results arrive', () => {
    const planner = new RestartPlanner(options);
    const delays: number[] = [];
    let now = 0;
    for (let i = 0; i < 5; i += 1) {
      const decision = planner.decide({
        now,
        wantRecord: true,
        hadResult: true,
        reason: 'end',
      });
      if (decision.action === 'restart') delays.push(decision.delayMs);
      now += 10_000;
    }
    expect(delays).toEqual([400, 800, 1600, 3000, 3000]);
  });

  it('switches to the deliberate pause after three silent ends', () => {
    const planner = new RestartPlanner(options);
    const delays: number[] = [];
    let now = 0;
    for (let i = 0; i < 5; i += 1) {
      const decision = planner.decide({
        now,
        wantRecord: true,
        hadResult: false,
        reason: 'end',
      });
      if (decision.action === 'restart') delays.push(decision.delayMs);
      now += 10_000;
    }
    expect(delays).toEqual([400, 800, 1500, 1500, 1500]);
  });

  it('applies the longer delay after three silent ends in a row', () => {
    const planner = new RestartPlanner(options);
    let now = 0;
    let last = 0;
    for (let i = 0; i < 3; i += 1) {
      const decision = planner.decide({
        now,
        wantRecord: true,
        hadResult: false,
        reason: 'end',
      });
      if (decision.action === 'restart') last = decision.delayMs;
      now += 10_000;
    }
    expect(last).toBe(1500);
  });

  it('resets the backoff after a real result', () => {
    const planner = new RestartPlanner(options);
    planner.decide({ now: 0, wantRecord: true, hadResult: false, reason: 'end' });
    planner.noteResult();
    const decision = planner.decide({
      now: 10_000,
      wantRecord: true,
      hadResult: true,
      reason: 'end',
    });
    expect(decision).toMatchObject({ action: 'restart', delayMs: 400, attempt: 1 });
  });

  it('keeps a minimum gap between two restarts', () => {
    const planner = new RestartPlanner(options);
    const first = planner.decide({
      now: 0,
      wantRecord: true,
      hadResult: true,
      reason: 'end',
    });
    expect(first).toMatchObject({ delayMs: 400 });
    const second = planner.decide({
      now: 450,
      wantRecord: true,
      hadResult: true,
      reason: 'end',
    });
    expect(second).toMatchObject({ delayMs: 250 });
  });
});

describe('watchdogThreshold', () => {
  it('doubles per consecutive silent restart and never exceeds the cap', () => {
    expect(watchdogThreshold(12_000, 0, 60_000)).toBe(12_000);
    expect(watchdogThreshold(12_000, 1, 60_000)).toBe(24_000);
    expect(watchdogThreshold(12_000, 2, 60_000)).toBe(48_000);
    expect(watchdogThreshold(12_000, 9, 60_000)).toBe(60_000);
  });
});
