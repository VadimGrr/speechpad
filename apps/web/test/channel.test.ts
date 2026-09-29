import { describe, expect, it } from 'vitest';
import { isSyncMessage, SyncBus, type ChannelLike, type SyncMessage } from '../src/channel';

class Hub {
  readonly channels = new Set<FakeChannel>();

  create(): FakeChannel {
    const channel = new FakeChannel(this);
    this.channels.add(channel);
    return channel;
  }
}

class FakeChannel implements ChannelLike {
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(private readonly hub: Hub) {}

  postMessage(message: unknown): void {
    const event = new MessageEvent('message', { data: message });
    for (const channel of this.hub.channels) {
      if (channel !== this) channel.deliver(event);
    }
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  close(): void {
    this.hub.channels.delete(this);
    this.listeners.clear();
  }

  deliver(event: MessageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

describe('SyncBus', () => {
  it('delivers messages between two windows', () => {
    const hub = new Hub();
    const main = new SyncBus(hub.create());
    const float = new SyncBus(hub.create());
    const received: SyncMessage[] = [];
    float.onMessage((message) => received.push(message));

    main.send({ kind: 'interim', text: 'черновик' });
    main.send({ kind: 'final', text: 'финал' });

    expect(received).toEqual([
      { kind: 'interim', text: 'черновик' },
      { kind: 'final', text: 'финал' },
    ]);
  });

  it('never echoes a message back to its sender', () => {
    const hub = new Hub();
    const main = new SyncBus(hub.create());
    const seen: SyncMessage[] = [];
    main.onMessage((message) => seen.push(message));
    main.send({ kind: 'reset' });
    expect(seen).toEqual([]);
  });

  it('drops foreign and malformed payloads', () => {
    const hub = new Hub();
    const bus = new SyncBus(hub.create());
    const peer = hub.create();
    const seen: SyncMessage[] = [];
    bus.onMessage((message) => seen.push(message));

    peer.deliver(new MessageEvent('message', { data: { kind: 'nope' } }));
    peer.deliver(new MessageEvent('message', { data: 'строка' }));
    peer.deliver(new MessageEvent('message', { data: null }));
    peer.deliver(new MessageEvent('message', { data: { kind: 'command', command: 'exit' } }));

    expect(seen).toEqual([]);

    peer.postMessage({ kind: 'command', command: 'toggle' });
    expect(seen).toEqual([{ kind: 'command', command: 'toggle' }]);
  });

  it('stops delivering after close', () => {
    const hub = new Hub();
    const main = new SyncBus(hub.create());
    const float = new SyncBus(hub.create());
    const seen: SyncMessage[] = [];
    float.onMessage((message) => seen.push(message));
    float.close();
    main.send({ kind: 'reset' });
    expect(seen).toEqual([]);
  });

  it('removes a listener on unsubscribe', () => {
    const hub = new Hub();
    const main = new SyncBus(hub.create());
    const float = new SyncBus(hub.create());
    const seen: SyncMessage[] = [];
    const off = float.onMessage((message) => seen.push(message));
    off();
    main.send({ kind: 'reset' });
    expect(seen).toEqual([]);
  });

  it('returns null when BroadcastChannel is missing', () => {
    const original = globalThis.BroadcastChannel;
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    try {
      expect(SyncBus.open()).toBeNull();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});

describe('isSyncMessage', () => {
  it('accepts every known kind', () => {
    for (const kind of ['hello', 'snapshot', 'state', 'interim', 'final', 'reset', 'bye']) {
      expect(isSyncMessage({ kind })).toBe(true);
    }
    expect(isSyncMessage({ kind: 'command', command: 'copy' })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSyncMessage({ kind: 'unknown' })).toBe(false);
    expect(isSyncMessage({ kind: 'command', command: 'rm -rf' })).toBe(false);
    expect(isSyncMessage(undefined)).toBe(false);
    expect(isSyncMessage('final')).toBe(false);
  });
});
