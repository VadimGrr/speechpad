export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_GLOBAL = '__SPEECHPAD_AGENT__';

export type InsertScheme = 'clipboard' | 'unicode';
export type AgentStatus = 'offline' | 'connecting' | 'online' | 'error';
export type AgentCommand = 'toggle' | 'topmost' | 'clear';
export type HotkeyAction = AgentCommand;

export interface AgentHandshake {
  token: string;
  port: number;
  insertScheme: InsertScheme;
  version: number;
}

export interface AgentSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}

export interface AgentServerMessage {
  type: 'ready' | 'inserted' | 'hotkey' | 'error';
  ok?: boolean;
  scheme?: string;
  action?: string;
  message?: string;
  insertScheme?: InsertScheme;
  port?: number;
  processId?: number;
  version?: number;
  licenseState?: string;
  licenseMessage?: string;
  insertAllowed?: boolean;
  extensionAllowed?: boolean;
}

export interface AgentClientOptions {
  handshake: AgentHandshake;
  createSocket?: (url: string) => AgentSocket;
  host?: string;
  minReconnectMs?: number;
  maxReconnectMs?: number;
  maxAttempts?: number;
  setTimeoutFn?: (handler: () => void, timeout: number) => number;
  clearTimeoutFn?: (handle: number) => void;
}

export interface InsertOutcome {
  ok: boolean;
  scheme: string;
}

export interface AgentLicense {
  state: string;
  message: string;
  insertAllowed: boolean;
  extensionAllowed: boolean;
}

export function isAgentHandshake(value: unknown): value is AgentHandshake {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (typeof raw['token'] !== 'string' || raw['token'].length < 16) return false;
  if (typeof raw['port'] !== 'number' || !Number.isInteger(raw['port'])) return false;
  if (raw['insertScheme'] !== 'clipboard' && raw['insertScheme'] !== 'unicode') return false;
  if (raw['version'] !== undefined && raw['version'] !== AGENT_PROTOCOL_VERSION) return false;
  return true;
}

export function readInjectedHandshake(scope: unknown = globalThis): AgentHandshake | null {
  const holder = scope as Record<string, unknown> | null | undefined;
  if (!holder) return null;
  const value = holder[AGENT_GLOBAL];
  return isAgentHandshake(value) ? value : null;
}

function isAgentMessage(value: unknown): value is AgentServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'ready' || type === 'inserted' || type === 'hotkey' || type === 'error';
}

export class AgentClient {
  private readonly handshake: AgentHandshake;
  private readonly createSocket: (url: string) => AgentSocket;
  private readonly url: string;
  private readonly minReconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly maxAttempts: number;
  private readonly setTimeoutFn: (handler: () => void, timeout: number) => number;
  private readonly clearTimeoutFn: (handle: number) => void;
  private readonly statusListeners = new Set<(status: AgentStatus, detail?: string) => void>();
  private readonly hotkeyListeners = new Set<(action: HotkeyAction) => void>();
  private readonly errorListeners = new Set<(message: string) => void>();
  private readonly licenseListeners = new Set<(info: AgentLicense) => void>();
  private readonly pending = new Map<number, (outcome: InsertOutcome) => void>();
  private socket: AgentSocket | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private seq = 0;
  private closedByUser = false;
  private currentStatus: AgentStatus = 'offline';
  private currentLicense: AgentLicense = {
    state: 'unknown',
    message: '',
    insertAllowed: true,
    extensionAllowed: true,
  };

  constructor(options: AgentClientOptions) {
    this.handshake = options.handshake;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as AgentSocket);
    const host = options.host ?? '127.0.0.1';
    this.url = `ws://${host}:${this.handshake.port}/ws?token=${encodeURIComponent(this.handshake.token)}`;
    this.minReconnectMs = options.minReconnectMs ?? 500;
    this.maxReconnectMs = options.maxReconnectMs ?? 8000;
    this.maxAttempts = options.maxAttempts ?? 6;
    this.setTimeoutFn = options.setTimeoutFn ?? ((handler, timeout) => setTimeout(handler, timeout) as unknown as number);
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  }

  get status(): AgentStatus {
    return this.currentStatus;
  }

  get insertScheme(): InsertScheme {
    return this.handshake.insertScheme;
  }

  get port(): number {
    return this.handshake.port;
  }

  get license(): AgentLicense {
    return this.currentLicense;
  }

  onLicense(listener: (info: AgentLicense) => void): () => void {
    this.licenseListeners.add(listener);
    return () => {
      this.licenseListeners.delete(listener);
    };
  }

  onStatus(listener: (status: AgentStatus, detail?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onHotkey(listener: (action: HotkeyAction) => void): () => void {
    this.hotkeyListeners.add(listener);
    return () => {
      this.hotkeyListeners.delete(listener);
    };
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  command(name: AgentCommand): void {
    this.send({ type: 'command', name });
  }

  insert(text: string): Promise<InsertOutcome> {
    if (this.currentStatus !== 'online') {
      return Promise.resolve({ ok: false, scheme: this.insertScheme });
    }
    const seq = ++this.seq;
    return new Promise<InsertOutcome>((resolve) => {
      this.pending.set(seq, resolve);
      this.send({ type: 'insert', text, seq });
    });
  }

  close(): void {
    this.closedByUser = true;
    this.cancelReconnect();
    this.failPending({ ok: false, scheme: this.insertScheme });
    this.socket?.close();
    this.socket = null;
    this.setStatus('offline');
  }

  private open(): void {
    if (this.closedByUser) return;
    this.cancelReconnect();
    this.setStatus('connecting');
    let socket: AgentSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect('не удалось открыть сокет');
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.send({ type: 'hello', version: AGENT_PROTOCOL_VERSION });
    });
    socket.addEventListener('message', (event) => {
      this.receive(event.data);
    });
    socket.addEventListener('error', () => {
      this.setStatus('error', 'соединение с агентом прервано');
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.closedByUser) return;
      this.scheduleReconnect('агент недоступен');
    });
  }

  private receive(data: unknown): void {
    let parsed: unknown = data;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!isAgentMessage(parsed)) return;

    if (parsed.type === 'ready') {
      this.attempts = 0;
      this.setLicense(parsed);
      this.setStatus('online');
      return;
    }
    if (parsed.type === 'inserted') {
      const scheme = parsed.scheme ?? this.insertScheme;
      this.resolvePending(parsed.ok === true, scheme);
      return;
    }
    if (parsed.type === 'hotkey') {
      const action = parsed.action;
      if (action === 'toggle' || action === 'topmost' || action === 'clear') {
        for (const listener of [...this.hotkeyListeners]) listener(action);
      }
      return;
    }
    this.resolvePending(false, this.insertScheme);
    const message = parsed.message ?? 'агент вернул ошибку';
    for (const listener of [...this.errorListeners]) listener(message);
  }

  private setLicense(message: AgentServerMessage): void {
    if (message.licenseState === undefined) return;
    const next: AgentLicense = {
      state: message.licenseState,
      message: message.licenseMessage ?? '',
      insertAllowed: message.insertAllowed !== false,
      extensionAllowed: message.extensionAllowed !== false,
    };
    if (
      next.state === this.currentLicense.state &&
      next.message === this.currentLicense.message &&
      next.insertAllowed === this.currentLicense.insertAllowed &&
      next.extensionAllowed === this.currentLicense.extensionAllowed
    ) {
      return;
    }
    this.currentLicense = next;
    for (const listener of [...this.licenseListeners]) listener(next);
  }

  private send(payload: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.scheduleReconnect('сообщение не отправлено');
    }
  }

  private resolvePending(ok: boolean, scheme: string): void {
    if (this.pending.size === 0) return;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, resolve] of entries) resolve({ ok, scheme });
  }

  private failPending(outcome: InsertOutcome): void {
    this.resolvePending(outcome.ok, outcome.scheme);
  }

  private scheduleReconnect(detail: string): void {
    if (this.closedByUser) return;
    if (this.attempts >= this.maxAttempts) {
      this.setStatus('error', detail);
      return;
    }
    this.attempts += 1;
    this.setStatus('connecting', detail);
    const delay = Math.min(this.minReconnectMs * 2 ** (this.attempts - 1), this.maxReconnectMs);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer === null) return;
    this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: AgentStatus, detail?: string): void {
    if (this.currentStatus === status && detail === undefined) return;
    this.currentStatus = status;
    for (const listener of [...this.statusListeners]) listener(status, detail);
  }
}
