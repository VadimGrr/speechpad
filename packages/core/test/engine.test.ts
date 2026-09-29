import { beforeEach, describe, expect, it } from 'vitest';
import { SpeechEngine } from '../src/engine.js';
import type {
  ErrorEvent,
  FinalEvent,
  PartialEvent,
  RestartEvent,
  StateEvent,
} from '../src/types.js';
import { FakeClock, FakeFactory } from './helpers.js';

type Harness = {
  engine: SpeechEngine;
  clock: FakeClock;
  factory: FakeFactory;
  finals: string[];
  finalsRaw: FinalEvent[];
  partials: PartialEvent[];
  errors: ErrorEvent[];
  restarts: RestartEvent[];
  states: StateEvent[];
};

function harness(config: Record<string, unknown> = {}): Harness {
  const clock = new FakeClock();
  const factory = new FakeFactory();
  const engine = new SpeechEngine({ clock, factory, ...config });
  const finals: string[] = [];
  const finalsRaw: FinalEvent[] = [];
  const partials: PartialEvent[] = [];
  const errors: ErrorEvent[] = [];
  const restarts: RestartEvent[] = [];
  const states: StateEvent[] = [];
  engine.on('final', (event) => {
    finalsRaw.push(event);
    if (!event.dropped) finals.push(event.text);
  });
  engine.on('partial', (event) => partials.push(event));
  engine.on('error', (event) => errors.push(event));
  engine.on('restart', (event) => restarts.push(event));
  engine.on('state', (event) => states.push(event));
  return { engine, clock, factory, finals, finalsRaw, partials, errors, restarts, states };
}

describe('SpeechEngine lifecycle', () => {
  it('applies the required recognition settings', () => {
    const { engine, factory } = harness();
    engine.start();
    const rec = factory.last;
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe('ru-RU');
    expect(rec.maxAlternatives).toBe(1);
  });

  it('reports listening after start and paused after pause', () => {
    const { engine, states } = harness();
    engine.start();
    expect(engine.state).toBe('listening');
    engine.pause();
    expect(engine.state).toBe('paused');
    expect(states.map((s) => s.state)).toContain('paused');
  });

  it('start is idempotent and never creates a second recognizer', () => {
    const { engine, factory } = harness();
    engine.start();
    engine.start();
    expect(factory.count).toBe(1);
  });

  it('toggle switches between listening and paused', () => {
    const { engine } = harness();
    engine.toggle();
    expect(engine.state).toBe('listening');
    engine.toggle();
    expect(engine.state).toBe('paused');
    engine.toggle();
    expect(engine.state).toBe('listening');
  });

  it('fails cleanly when the browser has no Web Speech API', () => {
    const clock = new FakeClock();
    const factory = new FakeFactory(false, 'not-supported');
    const engine = new SpeechEngine({ clock, factory });
    const errors: ErrorEvent[] = [];
    engine.on('error', (event) => errors.push(event));
    engine.start();
    expect(engine.state).toBe('error');
    expect(errors[0]?.fatal).toBe(true);
    expect(errors[0]?.code).toBe('not-supported');
  });
});

describe('SpeechEngine results', () => {
  it('emits partial text and final text separately', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'привет ', final: false }]);
    h.factory.last.emitResult([
      { text: 'привет мир', final: true },
      { text: 'как дела', final: false },
    ]);
    expect(h.partials.at(-1)?.text).toBe('как дела');
    expect(h.finals).toEqual(['привет мир']);
    expect(h.engine.transcriptText).toBe('привет мир');
  });

  it('clears the interim layer when a session ends', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'черновик', final: false }]);
    h.factory.last.emitEnd();
    expect(h.partials.at(-1)?.text).toBe('');
  });

  it('joins final fragments with a single space', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'первая фраза', final: true }]);
    h.clock.advance(10);
    h.factory.last.emitResult([{ text: 'вторая фраза', final: true }]);
    expect(h.engine.transcriptText).toBe('первая фраза вторая фраза');
  });
});

describe('SpeechEngine deduplication', () => {
  it('blocks a final that repeats the tail after an auto restart', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'мы обсудили план и сроки', final: true }]);
    h.factory.last.emitEnd();
    h.clock.advance(500);
    h.factory.last.emitResult([{ text: 'мы обсудили план и сроки', final: true }]);
    expect(h.finals).toEqual(['мы обсудили план и сроки']);
    expect(h.finalsRaw.at(-1)?.dropped).toBe(true);
    expect(h.engine.metrics().duplicatesBlocked).toBe(1);
  });

  it('keeps the new remainder of a partially repeated final', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'вчера мы говорили о бюджете', final: true }]);
    h.factory.last.emitEnd();
    h.clock.advance(500);
    h.factory.last.emitResult([{ text: 'бюджете на следующий квартал', final: true }]);
    expect(h.finals.at(-1)).toBe('на следующий квартал');
  });

  it('blocks an immediate repeat of the same final', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'совершенно новая фраза', final: true }]);
    h.clock.advance(20);
    h.factory.last.emitResult([{ text: 'совершенно новая фраза', final: true }]);
    expect(h.finals).toEqual(['совершенно новая фраза']);
  });
});

describe('SpeechEngine restart policy', () => {
  it('restarts after onend while the user still wants to record', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'фраза перед обрывом', final: true }]);
    h.factory.last.emitEnd();
    expect(h.factory.count).toBe(1);
    h.clock.advance(399);
    expect(h.factory.count).toBe(1);
    h.clock.advance(1);
    expect(h.factory.count).toBe(2);
    expect(h.restarts[0]?.reason).toBe('end');
  });

  it('does not restart after pause', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitEnd();
    h.engine.pause();
    h.clock.advance(10_000);
    expect(h.factory.count).toBe(1);
  });

  it('backs off exponentially on repeated silent ends', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitEnd();
    h.clock.advance(400);
    expect(h.factory.count).toBe(2);
    h.factory.last.emitEnd();
    h.clock.advance(800);
    expect(h.factory.count).toBe(3);
    h.factory.last.emitEnd();
    h.clock.advance(1600);
    expect(h.factory.count).toBe(4);
  });

  it('delays longer after three consecutive silent ends', () => {
    const h = harness();
    h.engine.start();
    for (let i = 0; i < 3; i += 1) {
      h.factory.last.emitEnd();
      h.clock.advance(4000);
    }
    const silentRun = h.restarts.length;
    expect(silentRun).toBe(3);
    const last = h.restarts.at(-1);
    expect(last?.delayMs).toBeGreaterThanOrEqual(1500);
  });

  it('resets backoff after a real result', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitEnd();
    h.clock.advance(400);
    h.factory.last.emitEnd();
    h.clock.advance(800);
    h.factory.last.emitResult([{ text: 'речь снова пошла', final: true }]);
    h.factory.last.emitEnd();
    h.clock.advance(400);
    expect(h.factory.count).toBe(4);
  });

  it('retries when start throws InvalidStateError', () => {
    const h = harness();
    h.factory.startErrorFor = (index) =>
      index === 0 ? new Error('InvalidStateError: already started') : null;
    h.engine.start();
    expect(h.engine.state).toBe('listening');
    h.clock.advance(400);
    expect(h.factory.count).toBe(2);
  });

  it('restarts on lang change without losing the wantRecord intent', () => {
    const h = harness();
    h.engine.start();
    const before = h.factory.count;
    h.engine.setLang('en-US');
    h.clock.advance(200);
    expect(h.factory.count).toBe(before + 1);
    expect(h.factory.last.lang).toBe('en-US');
    expect(h.engine.state).toBe('listening');
  });
});

describe('SpeechEngine watchdog', () => {
  it('does not restart before the silence threshold', () => {
    const h = harness();
    h.engine.start();
    h.clock.advance(11_000);
    expect(h.factory.count).toBe(1);
  });

  it('restarts after prolonged silence', () => {
    const h = harness();
    h.engine.start();
    h.clock.advance(11_000);
    expect(h.factory.count).toBe(1);
    h.clock.advance(3_500);
    expect(h.factory.count).toBe(2);
    expect(h.restarts[0]?.reason).toBe('watchdog');
    expect(h.engine.metrics().watchdogRestarts).toBe(1);
  });

  it('grows the threshold while the engine keeps hearing nothing', () => {
    const h = harness();
    h.engine.start();
    h.clock.advance(14_000);
    expect(h.factory.count).toBe(2);
    h.clock.advance(20_000);
    expect(h.factory.count).toBe(2);
    h.clock.advance(6_000);
    expect(h.factory.count).toBe(3);
  });

  it('keeps a single recognizer alive during long silence', () => {
    const h = harness();
    h.engine.start();
    h.clock.advance(120_000);
    expect(h.engine.state).toBe('listening');
    expect(h.factory.last.started).toBe(true);
  });

  it('stops the watchdog on pause', () => {
    const h = harness();
    h.engine.start();
    h.engine.pause();
    h.clock.advance(60_000);
    expect(h.factory.count).toBe(1);
  });

  it('recycles the recognizer after the long session threshold', () => {
    const h = harness({ recycleAfterMs: 60_000, recycleQuietMs: 1000 });
    h.engine.start();
    for (let i = 1; i <= 11; i += 1) {
      h.clock.advance(5_000);
      h.factory.last.emitResult([{ text: `фраза номер ${i}`, final: true }]);
    }
    h.clock.advance(5_000);
    expect(h.factory.count).toBe(1);
    h.clock.advance(400);
    expect(h.factory.count).toBe(2);
    expect(h.restarts[0]?.reason).toBe('recycle');
    expect(h.engine.metrics().recycles).toBe(1);
  });
});

describe('SpeechEngine error policy', () => {
  it('retries on network errors and keeps listening', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitError('network');
    expect(h.errors[0]?.fatal).toBe(false);
    h.factory.last.emitEnd();
    h.clock.advance(400);
    expect(h.factory.count).toBe(2);
    expect(h.engine.state).toBe('listening');
  });

  it.each(['no-speech', 'aborted'])('retries on %s', (code) => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitError(code);
    h.factory.last.emitEnd();
    h.clock.advance(400);
    expect(h.factory.count).toBe(2);
  });

  it('restarts even if the browser does not emit onend after an error', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitError('no-speech');
    h.clock.advance(2000);
    expect(h.factory.count).toBe(2);
  });

  it.each(['not-allowed', 'service-not-allowed', 'audio-capture'])(
    'stops on fatal error %s',
    (code) => {
      const h = harness();
      h.engine.start();
      h.factory.last.emitError(code);
      expect(h.engine.state).toBe('error');
      expect(h.errors[0]?.fatal).toBe(true);
      expect(h.errors[0]?.message.length).toBeGreaterThan(10);
      h.clock.advance(30_000);
      expect(h.factory.count).toBe(1);
    },
  );

  it('can be started again after a fatal error', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitError('not-allowed');
    h.engine.start();
    expect(h.engine.state).toBe('listening');
    expect(h.factory.count).toBe(2);
  });
});

describe('SpeechEngine metrics', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.engine.start();
  });

  it('reports restart latency back to a fresh interim', () => {
    h.factory.last.emitEnd();
    h.clock.advance(400);
    h.clock.advance(700);
    h.factory.last.emitResult([{ text: 'первые слова', final: true }]);
    const metrics = h.engine.metrics();
    expect(metrics.firstInterimAfterStartMs).toBe(1100);
    expect(metrics.lastInterimAfterRestartMs).toBe(700);
  });

  it('tracks the longest silence gap and interim cadence', () => {
    h.clock.advance(2000);
    h.factory.last.emitResult([{ text: 'раз', final: false }]);
    h.clock.advance(3000);
    h.factory.last.emitResult([{ text: 'два', final: false }]);
    h.clock.advance(1000);
    h.factory.last.emitResult([{ text: 'три', final: true }]);
    const metrics = h.engine.metrics();
    expect(metrics.avgInterimIntervalMs).toBe(2000);
    expect(metrics.maxSilenceGapMs).toBe(3000);
    expect(metrics.finals).toBe(1);
  });
});

describe('SpeechEngine transcript sync', () => {
  it('follows manual edits without emitting text', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'исходная фраза', final: true }]);
    h.engine.syncTranscript('текст изменён пользователем вручную');
    expect(h.engine.transcriptText).toBe('текст изменён пользователем вручную');
    expect(h.finals).toEqual(['исходная фраза']);
  });

  it('clears the transcript on demand', () => {
    const h = harness();
    h.engine.start();
    h.factory.last.emitResult([{ text: 'что-то было', final: true }]);
    h.engine.clear();
    expect(h.engine.transcriptText).toBe('');
  });
});
