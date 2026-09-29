import type { RuntimeApi } from './chrome-types';
import { isLocalOrigin, isWebRequest, EXT_SOURCE, WEB_SOURCE, type BridgeReply } from './protocol';

export interface BridgeDeps {
  window: Window;
  runtime: Pick<RuntimeApi, 'sendMessage'>;
}

export interface BridgeRequest {
  kind: 'bridge-ready' | 'bridge-invalidate';
  origin: string;
  pageId: string;
}

export interface BridgeEnvelope {
  kind: 'web-request';
  request: unknown;
}

export function isLocalPageOrigin(origin: string): boolean {
  return isLocalOrigin(origin);
}

function randomId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createBridge(deps: BridgeDeps, pageId = randomId()) {
  const win = deps.window;
  const location = win.location;
  const origin = location.origin;
  const targetOrigin = origin && origin !== 'null' ? origin : '*';

  function reply(message: BridgeReply): void {
    win.postMessage(message, targetOrigin);
  }

  async function forward(request: unknown): Promise<BridgeReply | null> {
    if (!isWebRequest(request)) {
      const record = request as { source?: unknown } | null;
      if (record?.source !== WEB_SOURCE) return null;
      return { source: EXT_SOURCE, kind: 'inserted', ok: false, seq: 0, target: null, message: 'запрос не распознан' };
    }
    const envelope: BridgeEnvelope = { kind: 'web-request', request };
    try {
      const response = (await deps.runtime.sendMessage(envelope)) as BridgeReply | undefined;
      if (response && response.source === EXT_SOURCE) return response;
      if (request.kind === 'ping') return { source: EXT_SOURCE, kind: 'ready', authorized: false, origins: [] };
      return {
        source: EXT_SOURCE,
        kind: 'inserted',
        ok: false,
        seq: request.seq,
        target: null,
        message: 'фоновая часть расширения не ответила',
      };
    } catch {
      return { source: EXT_SOURCE, kind: 'inserted', ok: false, seq: 0, target: null, message: 'расширение недоступно' };
    }
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== win) return;
    const eventOrigin = event.origin === '' ? origin : event.origin;
    if (!isLocalOrigin(eventOrigin)) return;
    const record = event.data as { source?: unknown } | null;
    if (record?.source === EXT_SOURCE) return;
    void forward(event.data).then((response) => {
      if (response) reply(response);
    });
  }

  function start(): void {
    win.addEventListener('message', onMessage);
    const ready: BridgeRequest = { kind: 'bridge-ready', origin, pageId };
    void deps.runtime.sendMessage(ready).catch(() => undefined);
  }

  function stop(): void {
    win.removeEventListener('message', onMessage);
    const invalidate: BridgeRequest = { kind: 'bridge-invalidate', origin, pageId };
    void deps.runtime.sendMessage(invalidate).catch(() => undefined);
  }

  return { start, stop, origin, pageId };
}
