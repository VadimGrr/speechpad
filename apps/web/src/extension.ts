import {
  EXT_SOURCE,
  WEB_SOURCE,
  isBridgeReply,
  type BridgeReply,
} from '@speechpad/extension-protocol';

export interface ExtensionAvailability {
  available: boolean;
  authorized: boolean;
  origins: string[];
}

export interface ExtensionInsertOutcome {
  ok: boolean;
  target: string | null;
  message: string | null;
}

export interface ExtensionClientOptions {
  window?: Window;
  timeoutMs?: number;
  setTimeoutFn?: (handler: () => void, timeout: number) => number;
  clearTimeoutFn?: (handle: number) => void;
}

const UNAVAILABLE: ExtensionAvailability = { available: false, authorized: false, origins: [] };

export class ExtensionClient {
  private readonly scope: Window;
  private readonly timeoutMs: number;
  private readonly setTimeoutFn: (handler: () => void, timeout: number) => number;
  private readonly clearTimeoutFn: (handle: number) => void;
  private readonly listener: (event: MessageEvent) => void;
  private readonly waiters = new Set<(reply: BridgeReply) => void>();
  private seq = 0;

  constructor(options: ExtensionClientOptions = {}) {
    this.scope = options.window ?? globalThis.window;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => setTimeout(handler, timeout) as unknown as number);
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    this.listener = (event: MessageEvent) => {
      if (event.source !== this.scope) return;
      if (!isBridgeReply(event.data)) return;
      for (const waiter of [...this.waiters]) waiter(event.data);
    };
  }

  get connected(): boolean {
    return this.scope !== undefined;
  }

  start(): void {
    this.scope?.addEventListener('message', this.listener);
  }

  stop(): void {
    this.scope?.removeEventListener('message', this.listener);
    this.waiters.clear();
  }

  private request<T extends BridgeReply>(message: unknown, accept: (reply: BridgeReply) => boolean): Promise<T | null> {
    const scope = this.scope;
    if (!scope) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        this.clearTimeoutFn(timer);
        this.waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (reply: BridgeReply): void => {
        if (accept(reply)) finish(reply as T);
      };
      this.waiters.add(waiter);
      const timer = this.setTimeoutFn(() => finish(null), this.timeoutMs);
      try {
        scope.postMessage(message, scope.location.origin);
      } catch {
        finish(null);
      }
    });
  }

  probe(): Promise<ExtensionAvailability> {
    return this.request<BridgeReply>({ source: WEB_SOURCE, kind: 'ping' }, (reply) => reply.kind === 'ready').then(
      (reply) => {
        if (reply?.kind !== 'ready') return { ...UNAVAILABLE };
        return { available: true, authorized: reply.authorized, origins: reply.origins ?? [] };
      },
    );
  }

  insert(text: string): Promise<ExtensionInsertOutcome> {
    const seq = ++this.seq;
    return this.request<BridgeReply>({ source: WEB_SOURCE, kind: 'insert', text, seq }, (reply) => {
      return reply.kind === 'inserted' && reply.seq === seq;
    }).then((reply) => {
      if (reply?.kind !== 'inserted') {
        return { ok: false, target: null, message: 'расширение не ответило' };
      }
      return { ok: reply.ok, target: reply.target ?? null, message: reply.message ?? null };
    });
  }
}

export function extensionSource(): string {
  return EXT_SOURCE;
}
