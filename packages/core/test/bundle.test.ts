import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bundlePath = resolve(__dirname, '../dist/speechpad.js');
const hasBundle = existsSync(bundlePath);

function loadBundle(scope: Record<string, unknown>): Record<string, unknown> {
  const context = createContext({ ...scope, console });
  runInContext(readFileSync(bundlePath, 'utf8'), context);
  return context as unknown as Record<string, unknown>;
}

describe('dist/speechpad.js', () => {
  it.skipIf(!hasBundle)('exposes a global Speechpad namespace', () => {
    const context = loadBundle({});
    const api = context['Speechpad'] as Record<string, unknown>;
    expect(typeof api['SpeechpadEngine']).toBe('function');
    expect(typeof api['createEngine']).toBe('function');
    expect(typeof api['dedupeFragment']).toBe('function');
    expect(api['version']).toBe('0.1.0');
  });

  it.skipIf(!hasBundle)('detects a missing Web Speech API', () => {
    const context = loadBundle({});
    const api = context['Speechpad'] as Record<string, unknown>;
    const Ctor = api['SpeechpadEngine'] as { isSupported(scope: unknown): boolean };
    expect(Ctor.isSupported({})).toBe(false);
    expect(Ctor.isSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });

  it.skipIf(!hasBundle)('requires a secure context', () => {
    const context = loadBundle({});
    const api = context['Speechpad'] as Record<string, unknown>;
    const Ctor = api['SpeechpadEngine'] as {
      new (options: Record<string, unknown>): { isSupported: boolean; unsupportedReason: string | null };
    };
    const engine = new Ctor({
      scope: { webkitSpeechRecognition: function () {}, isSecureContext: false },
    });
    expect(engine.isSupported).toBe(false);
    expect(engine.unsupportedReason).toBe('insecure-context');
  });
});
