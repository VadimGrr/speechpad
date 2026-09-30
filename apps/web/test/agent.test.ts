import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROTOCOL_VERSION,
  AgentClient,
  isAgentHandshake,
  readInjectedHandshake,
  type AgentSocket,
  type AgentStatus,
  type AgentLicense,
} from '../src/agent';

type Listener = (event: { data: unknown } | undefined) => void;

class FakeSocket {
  static last: FakeSocket | null = null;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit('close', undefined);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  open(): void {
    this.emit('open', undefined);
  }

  message(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  synth(): void {
    this.emit('message', { data: 'не json' });
  }

  drop(): void {
    this.emit('close', undefined);
  }

  sentMessages(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  private emit(type: string, event: { data: unknown } | undefined): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const handshake = {
  token: 'A'.repeat(48),
  port: 8787,
  insertScheme: 'clipboard' as const,
  version: AGENT_PROTOCOL_VERSION,
};

function createClient(overrides: Partial<ConstructorParameters<typeof AgentClient>[0]> = {}) {
  const statuses: { status: AgentStatus; detail?: string }[] = [];
  const client = new AgentClient({
    handshake,
    createSocket: (url) => new FakeSocket(url) as unknown as AgentSocket,
    ...overrides,
  });
  client.onStatus((status, detail) => statuses.push({ status, detail }));
  return { client, statuses, socket: () => FakeSocket.last as FakeSocket };
}

function online() {
  const harness = createClient();
  harness.client.connect();
  harness.socket().open();
  harness.socket().message({ type: 'ready', insertScheme: 'clipboard', port: 8787, version: 1 });
  return harness;
}

afterEach(() => {
  FakeSocket.last = null;
  vi.useRealTimers();
});

describe('agent handshake', () => {
  it('accepts a payload injected by the native agent', () => {
    expect(isAgentHandshake(handshake)).toBe(true);
  });

  it('rejects anything that is not a full handshake', () => {
    expect(isAgentHandshake(null)).toBe(false);
    expect(isAgentHandshake({ ...handshake, token: 'short' })).toBe(false);
    expect(isAgentHandshake({ ...handshake, port: '8787' })).toBe(false);
    expect(isAgentHandshake({ ...handshake, insertScheme: 'sendinput' })).toBe(false);
    expect(isAgentHandshake({ ...handshake, version: 2 })).toBe(false);
  });

  it('reads the injection from a scope', () => {
    const scope: Record<string, unknown> = { __SPEECHPAD_AGENT__: handshake };
    expect(readInjectedHandshake(scope)).toEqual(handshake);
    expect(readInjectedHandshake({ __SPEECHPAD_AGENT__: { token: 'x' } })).toBeNull();
    expect(readInjectedHandshake(undefined)).toBeNull();
  });
});

describe('agent client', () => {
  it('builds the loopback url with the token and says hello', () => {
    const { client, socket, statuses } = createClient();
    client.connect();
    expect(statuses.at(-1)?.status).toBe('connecting');
    expect(socket().url).toBe(`ws://127.0.0.1:8787/ws?token=${'A'.repeat(48)}`);

    socket().open();
    expect(socket().sentMessages()).toEqual([{ type: 'hello', version: AGENT_PROTOCOL_VERSION }]);
  });

  it('goes online only after the agent says ready', () => {
    const { client, socket, statuses } = createClient();
    client.connect();
    socket().open();
    expect(client.status).toBe('connecting');
    socket().message({ type: 'ready', insertScheme: 'clipboard' });
    expect(client.status).toBe('online');
    expect(statuses.map((item) => item.status)).toContain('online');
  });

  it('inserts text and waits for the agent to confirm', async () => {
    const { client, socket } = online();
    const promise = client.insert('привет мир');
    expect(socket().sentMessages().at(-1)).toEqual({ type: 'insert', text: 'привет мир', seq: 1 });
    socket().message({ type: 'inserted', ok: true, scheme: 'clipboard' });
    await expect(promise).resolves.toEqual({ ok: true, scheme: 'clipboard' });
  });

  it('numbers inserts and reports failures from the agent', async () => {
    const { client, socket } = online();
    const first = client.insert('раз');
    const second = client.insert('два');
    const messages = socket().sentMessages();
    expect(messages.at(-2)).toMatchObject({ seq: 1 });
    expect(messages.at(-1)).toMatchObject({ seq: 2 });

    socket().message({ type: 'error', message: 'окно не найдено' });
    await expect(first).resolves.toEqual({ ok: false, scheme: 'clipboard' });
    await expect(second).resolves.toEqual({ ok: false, scheme: 'clipboard' });
  });

  it('does not queue inserts while the agent is offline', async () => {
    const { client, socket } = createClient();
    client.connect();
    const promise = client.insert('текст');
    socket().open();
    await expect(promise).resolves.toEqual({ ok: false, scheme: 'clipboard' });
    expect(socket().sent).toHaveLength(1);
  });

  it('forwards agent errors to the ui', () => {
    const { client, socket } = online();
    const errors: string[] = [];
    client.onError((message) => errors.push(message));
    socket().message({ type: 'error', message: 'буфер обмена занят' });
    expect(errors).toEqual(['буфер обмена занят']);
  });

  it('sends commands', () => {
    const { client, socket } = online();
    client.command('toggle');
    expect(socket().sentMessages().at(-1)).toEqual({ type: 'command', name: 'toggle' });
  });

  it('routes hotkey broadcasts and ignores unknown actions', () => {
    const { client, socket } = online();
    const actions: string[] = [];
    client.onHotkey((action) => actions.push(action));
    socket().message({ type: 'hotkey', action: 'clear' });
    socket().message({ type: 'hotkey', action: 'shutdown' });
    expect(actions).toEqual(['clear']);
  });

  it('ignores junk frames', () => {
    const { client, socket } = online();
    const actions: string[] = [];
    client.onHotkey((action) => actions.push(action));
    socket().synth();
    expect(actions).toEqual([]);
    expect(client.status).toBe('online');
  });

  it('reconnects with growing delays and gives up eventually', () => {
    vi.useFakeTimers();
    const { client, statuses } = createClient({ minReconnectMs: 100, maxReconnectMs: 400, maxAttempts: 3 });
    client.connect();
    const first = FakeSocket.last as FakeSocket;

    first.drop();
    vi.advanceTimersByTime(99);
    expect(FakeSocket.last).toBe(first);
    vi.advanceTimersByTime(1);
    const second = FakeSocket.last as FakeSocket;
    expect(second).not.toBe(first);

    second.drop();
    vi.advanceTimersByTime(199);
    expect(FakeSocket.last).toBe(second);
    vi.advanceTimersByTime(1);
    const third = FakeSocket.last as FakeSocket;
    expect(third).not.toBe(second);

    third.drop();
    vi.advanceTimersByTime(400);
    const fourth = FakeSocket.last as FakeSocket;
    expect(fourth).not.toBe(third);

    fourth.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.last).toBe(fourth);
    expect(client.status).toBe('error');
    expect(statuses.at(-1)?.status).toBe('error');
  });

  it('resets the backoff after a successful handshake', () => {
    vi.useFakeTimers();
    const { client, socket } = createClient({ minReconnectMs: 100, maxAttempts: 1 });
    client.connect();
    socket().open();
    socket().message({ type: 'ready' });
    socket().drop();
    vi.advanceTimersByTime(100);
    expect(client.status).toBe('connecting');
  });

  it('stops for good when the window closes', () => {
    vi.useFakeTimers();
    const { client, socket } = online();
    const pending = client.insert('текст');
    client.close();
    expect(socket().closed).toBe(true);
    expect(client.status).toBe('offline');
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.last).toBe(socket());
    return expect(pending).resolves.toEqual({ ok: false, scheme: 'clipboard' });
  });
});

describe('license reporting', () => {
  it('defaults to allowed before the agent says anything', () => {
    const { client } = createClient();
    expect(client.license).toEqual({
      state: 'unknown',
      message: '',
      insertAllowed: true,
      extensionAllowed: true,
    });
  });

  it('publishes the license state from the ready message', () => {
    const { client, socket } = createClient();
    const seen: AgentLicense[] = [];
    client.onLicense((info) => seen.push(info));
    client.connect();
    socket().open();
    socket().message({
      type: 'ready',
      insertScheme: 'clipboard',
      licenseState: 'valid',
      licenseMessage: 'действует до 2030-01-01',
      insertAllowed: true,
      extensionAllowed: true,
    });
    expect(client.license.state).toBe('valid');
    expect(client.license.insertAllowed).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('reports a blocked insertion when the license is missing', () => {
    const { client, socket } = createClient();
    client.connect();
    socket().open();
    socket().message({
      type: 'ready',
      insertScheme: 'clipboard',
      licenseState: 'missing',
      licenseMessage: 'лицензия не найдена',
      insertAllowed: false,
      extensionAllowed: false,
    });
    expect(client.license.state).toBe('missing');
    expect(client.license.insertAllowed).toBe(false);
    expect(client.license.extensionAllowed).toBe(false);
  });

  it('keeps the previous state when the agent sends no license fields', () => {
    const { client, socket } = createClient();
    client.connect();
    socket().open();
    socket().message({ type: 'ready', licenseState: 'trial', licenseMessage: 'осталось 2 дн.' });
    socket().message({ type: 'ready' });
    expect(client.license.state).toBe('trial');
  });

  it('does not repeat the same state', () => {
    const { client, socket } = createClient();
    const seen: AgentLicense[] = [];
    client.onLicense((info) => seen.push(info));
    client.connect();
    socket().open();
    const ready = {
      type: 'ready',
      licenseState: 'valid',
      licenseMessage: 'бессрочная лицензия',
      insertAllowed: true,
    };
    socket().message(ready);
    socket().message(ready);
    expect(seen).toHaveLength(1);
  });
});
