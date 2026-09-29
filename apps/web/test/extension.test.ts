import { describe, expect, it, vi } from 'vitest';
import { ExtensionClient } from '../src/extension';

interface Harness {
  client: ExtensionClient;
  scope: Window;
  posted: unknown[];
}

function harness(options: { reply?: (message: unknown) => unknown } = {}): Harness {
  const posted: unknown[] = [];
  const listeners = new Set<(event: MessageEvent) => void>();
  const scope = {
    location: { origin: 'http://127.0.0.1:8787' },
    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
      listeners.delete(listener);
    },
    postMessage(message: unknown): void {
      posted.push(message);
      const reply = options.reply?.(message);
      if (!reply) return;
      for (const listener of [...listeners]) {
        listener({ data: reply, origin: 'http://127.0.0.1:8787', source: scope } as unknown as MessageEvent);
      }
    },
  };
  const client = new ExtensionClient({ window: scope as unknown as Window, timeoutMs: 50 });
  client.start();
  return { client, scope: scope as unknown as Window, posted };
}

const PING = { source: 'speechpad-web', kind: 'ping' } as const;
const READY = { source: 'speechpad-extension', kind: 'ready', authorized: true, origins: ['http://127.0.0.1:8787'] };

describe('probe', () => {
  it('reports availability and authorization', async () => {
    const { client } = harness({ reply: () => READY });
    await expect(client.probe()).resolves.toEqual({
      available: true,
      authorized: true,
      origins: ['http://127.0.0.1:8787'],
    });
  });

  it('reports unauthorized when the bridge has no local page', async () => {
    const { client } = harness({
      reply: () => ({ source: 'speechpad-extension', kind: 'ready', authorized: false, origins: [] }),
    });
    await expect(client.probe()).resolves.toMatchObject({ available: true, authorized: false });
  });

  it('reports unavailable when nothing answers', async () => {
    const { client } = harness();
    await expect(client.probe()).resolves.toEqual({ available: false, authorized: false, origins: [] });
  });
});

describe('insert', () => {
  it('sends a seq and resolves on the matching reply', async () => {
    const seen: unknown[] = [];
    const { client, posted } = harness({
      reply: (message) => {
        seen.push(message);
        const record = message as { kind: string; seq?: number };
        if (record.kind !== 'insert') return null;
        return {
          source: 'speechpad-extension',
          kind: 'inserted',
          ok: true,
          seq: record.seq ?? 0,
          target: 'textarea#msg',
          message: null,
        };
      },
    });
    await expect(client.insert('привет')).resolves.toEqual({
      ok: true,
      target: 'textarea#msg',
      message: null,
    });
    expect(seen).toHaveLength(1);
    expect(posted).toEqual([{ source: 'speechpad-web', kind: 'insert', text: 'привет', seq: 1 }]);
  });

  it('ignores replies for another sequence', async () => {
    vi.useFakeTimers();
    const { client } = harness({
      reply: () => ({ source: 'speechpad-extension', kind: 'inserted', ok: true, seq: 99, target: 'x', message: null }),
    });
    const pending = client.insert('да');
    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toEqual({ ok: false, target: null, message: 'расширение не ответило' });
    vi.useRealTimers();
  });

  it('passes a failure through', async () => {
    const { client } = harness({
      reply: (message) => {
        const record = message as { kind: string; seq?: number };
        if (record.kind !== 'insert') return null;
        return {
          source: 'speechpad-extension',
          kind: 'inserted',
          ok: false,
          seq: record.seq ?? 0,
          target: null,
          message: 'в этой вкладке нет поля ввода',
        };
      },
    });
    await expect(client.insert('да')).resolves.toEqual({
      ok: false,
      target: null,
      message: 'в этой вкладке нет поля ввода',
    });
  });

  it('stops listening after stop()', async () => {
    const { client } = harness({ reply: () => READY });
    client.stop();
    await expect(client.probe()).resolves.toMatchObject({ available: false });
  });
});
