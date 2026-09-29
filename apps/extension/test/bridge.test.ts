import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridge } from '../src/bridge';

interface FakeWindow {
  location: { origin: string };
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
  postMessage(data: unknown, targetOrigin: string): void;
  emit(data: unknown, options?: { origin?: string; source?: unknown }): void;
  replies: unknown[];
}

function createFakeWindow(origin = 'http://127.0.0.1:8787'): FakeWindow {
  const listeners = new Set<(event: MessageEvent) => void>();
  const replies: unknown[] = [];
  const win: FakeWindow = {
    location: { origin },
    replies,
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(data) {
      const record = data as { source?: unknown } | null;
      if (record?.source === 'speechpad-extension') replies.push(data);
      for (const listener of [...listeners]) {
        listener({ data, origin, source: win } as unknown as MessageEvent);
      }
    },
    emit(data, options = {}) {
      const event = { data, origin: options.origin ?? origin, source: options.source ?? win } as unknown as MessageEvent;
      for (const listener of [...listeners]) listener(event);
    },
  };
  return win;
}

const open: Array<{ stop(): void }> = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.stop();
});

function harness(handler: (message: unknown) => Promise<unknown>, origin = 'http://127.0.0.1:8787') {
  const win = createFakeWindow(origin);
  const sent: unknown[] = [];
  const runtime = {
    sendMessage: vi.fn(async (message: unknown) => {
      sent.push(message);
      return handler(message);
    }),
  };
  const bridge = createBridge({ window: win as unknown as Window, runtime }, 'page-1');
  bridge.start();
  open.push(bridge);
  return { bridge, win, sent };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('bridge handshake', () => {
  it('announces the page origin on start and drops it on stop', async () => {
    const { bridge, sent } = harness(async () => ({ source: 'speechpad-extension', kind: 'ready', authorized: true }));
    expect(sent[0]).toEqual({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'page-1' });
    bridge.stop();
    await tick();
    expect(sent[1]).toEqual({ kind: 'bridge-invalidate', origin: 'http://127.0.0.1:8787', pageId: 'page-1' });
  });

  it('generates a page id when none is given', () => {
    const sent: unknown[] = [];
    const win = createFakeWindow();
    const bridge = createBridge({ window: win as unknown as Window, runtime: { sendMessage: async (m) => (sent.push(m), undefined) } });
    bridge.start();
    const record = sent[0] as { pageId?: unknown };
    expect(typeof record.pageId).toBe('string');
    expect(String(record.pageId).length).toBeGreaterThan(4);
  });

  it('answers a ping with the authorization state', async () => {
    const { win } = harness(async () => ({
      source: 'speechpad-extension',
      kind: 'ready',
      authorized: true,
      origins: ['http://127.0.0.1:8787'],
    }));
    win.emit({ source: 'speechpad-web', kind: 'ping' });
    await tick();
    expect(win.replies.at(-1)).toEqual({
      source: 'speechpad-extension',
      kind: 'ready',
      authorized: true,
      origins: ['http://127.0.0.1:8787'],
    });
  });

  it('falls back to unauthorized when the background is silent', async () => {
    const { win } = harness(async () => undefined);
    win.emit({ source: 'speechpad-web', kind: 'ping' });
    await tick();
    expect(win.replies.at(-1)).toEqual({ source: 'speechpad-extension', kind: 'ready', authorized: false, origins: [] });
  });
});

describe('bridge forwarding', () => {
  it('forwards an insert request and returns the result', async () => {
    const { win, sent } = harness(async () => ({
      source: 'speechpad-extension',
      kind: 'inserted',
      ok: true,
      seq: 5,
      target: 'textarea#msg',
      message: null,
    }));
    win.emit({ source: 'speechpad-web', kind: 'insert', text: 'привет', seq: 5 });
    await tick();
    expect(sent.at(-1)).toEqual({
      kind: 'web-request',
      request: { source: 'speechpad-web', kind: 'insert', text: 'привет', seq: 5 },
    });
    expect(win.replies.at(-1)).toEqual({
      source: 'speechpad-extension',
      kind: 'inserted',
      ok: true,
      seq: 5,
      target: 'textarea#msg',
      message: null,
    });
  });

  it('ignores messages from foreign origins and foreign windows', async () => {
    const { win, sent } = harness(async () => undefined);
    win.emit({ source: 'speechpad-web', kind: 'ping' }, { origin: 'https://evil.example' });
    win.emit({ source: 'speechpad-web', kind: 'ping' }, { source: {} });
    await tick();
    expect(sent).toHaveLength(1);
    expect(win.replies).toHaveLength(0);
  });

  it('rejects malformed payloads from the app without touching the background', async () => {
    const { win, sent } = harness(async () => undefined);
    win.emit({ source: 'evil', kind: 'insert', text: 'x', seq: 1 });
    win.emit({ source: 'speechpad-web', kind: 'insert', text: 42, seq: 1 });
    await tick();
    expect(sent).toHaveLength(1);
    expect(win.replies).toEqual([
      {
        source: 'speechpad-extension',
        kind: 'inserted',
        ok: false,
        seq: 0,
        target: null,
        message: 'запрос не распознан',
      },
    ]);
  });

  it('stays silent on its own replies instead of looping', async () => {
    const { win, sent } = harness(async () => undefined);
    win.emit({ source: 'speechpad-extension', kind: 'ready', authorized: true, origins: [] });
    await tick();
    expect(win.replies).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it('reports a failure when the background throws', async () => {
    const { win } = harness(async () => {
      throw new Error('boom');
    });
    win.emit({ source: 'speechpad-web', kind: 'insert', text: 'да', seq: 9 });
    await tick();
    expect(win.replies.at(-1)).toMatchObject({ kind: 'inserted', ok: false, message: 'расширение недоступно' });
  });

  it('works on a different loopback port', async () => {
    const { win } = harness(async () => undefined, 'http://localhost:5173');
    win.emit({ source: 'speechpad-web', kind: 'ping' });
    await tick();
    expect(win.replies.at(-1)).toMatchObject({ kind: 'ready' });
  });
});
