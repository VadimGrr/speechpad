import { describe, expect, it } from 'vitest';
import { SpeechpadEngine } from '../src/sdk.js';
import type { PublicState } from '../src/types.js';
import { FakeClock, FakeFactory } from './helpers.js';

function makeEngine(): {
  engine: SpeechpadEngine;
  clock: FakeClock;
  factory: FakeFactory;
  events: string[];
} {
  const clock = new FakeClock();
  const factory = new FakeFactory();
  const engine = new SpeechpadEngine({ clock, factory });
  const events: string[] = [];
  engine.on('partial', (text) => events.push(`partial:${text}`));
  engine.on('final', (text) => events.push(`final:${text}`));
  engine.on('duplicate', (info) => events.push(`duplicate:${info.reason}`));
  engine.on('state', (state: PublicState) => events.push(`state:${state}`));
  return { engine, clock, factory, events };
}

describe('SpeechpadEngine public API', () => {
  it('exposes the four documented states', () => {
    const { engine, factory, clock } = makeEngine();
    expect(engine.state).toBe('idle');
    engine.start();
    expect(engine.state).toBe('listening');
    engine.pause();
    expect(engine.state).toBe('paused');
    engine.stop();
    expect(engine.state).toBe('idle');
    engine.start();
    engine.toggle();
    expect(engine.state).toBe('paused');
    engine.toggle();
    expect(engine.state).toBe('listening');
    engine.stop();
    expect(factory.count).toBeGreaterThan(0);
    clock.advance(0);
  });

  it('sends plain strings to partial and final listeners', () => {
    const { engine, factory, events } = makeEngine();
    engine.start();
    factory.last.emitResult([{ text: 'сло', final: false }]);
    factory.last.emitResult([{ text: 'слова', final: true }]);
    expect(events).toContain('partial:сло');
    expect(events).toContain('final:слова');
  });

  it('never reports a dropped duplicate as final', () => {
    const { engine, factory, events } = makeEngine();
    engine.start();
    factory.last.emitResult([{ text: 'повторяемая фраза целиком', final: true }]);
    factory.last.emitResult([{ text: 'повторяемая фраза целиком', final: true }]);
    expect(events.filter((e) => e.startsWith('final:'))).toEqual([
      'final:повторяемая фраза целиком',
    ]);
    expect(events.some((e) => e.startsWith('duplicate:'))).toBe(true);
  });

  it('unsubscribes a listener', () => {
    const { engine, factory } = makeEngine();
    const seen: string[] = [];
    const off = engine.on('final', (text) => seen.push(text));
    engine.start();
    factory.last.emitResult([{ text: 'первая', final: true }]);
    off();
    factory.last.emitResult([{ text: 'вторая', final: true }]);
    expect(seen).toEqual(['первая']);
  });

  it('mirrors the transcript and interim text', () => {
    const { engine, factory } = makeEngine();
    engine.start();
    factory.last.emitResult([{ text: 'черновик', final: false }]);
    expect(engine.interim).toBe('черновик');
    factory.last.emitResult([{ text: 'черновик готов', final: true }]);
    expect(engine.transcript).toBe('черновик готов');
    expect(engine.interim).toBe('');
  });

  it('reports missing Web Speech support', () => {
    const engine = new SpeechpadEngine({
      clock: new FakeClock(),
      factory: new FakeFactory(false, 'not-supported'),
    });
    expect(engine.isSupported).toBe(false);
    expect(engine.unsupportedReason).toBe('not-supported');
  });

  it('stops emitting after destroy', () => {
    const { engine, factory, clock } = makeEngine();
    engine.start();
    engine.destroy();
    factory.last.emitResult([{ text: 'после уничтожения', final: true }]);
    clock.advance(10_000);
    expect(engine.transcript).toBe('');
    expect(engine.state).toBe('idle');
  });
});
