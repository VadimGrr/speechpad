import type { PublicState } from '@speechpad/core';

export const CHANNEL_NAME = 'speechpad';

export type Command = 'toggle' | 'clear' | 'copy' | 'focus-main';

export interface StatePayload {
  state: PublicState;
  supported: boolean;
  hasText: boolean;
  theme: 'dark' | 'light';
}

export type SyncMessage =
  | { kind: 'hello' }
  | ({ kind: 'snapshot'; text: string } & StatePayload)
  | ({ kind: 'state' } & StatePayload)
  | { kind: 'interim'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'reset' }
  | { kind: 'command'; command: Command }
  | { kind: 'bye' };

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

const KINDS = new Set([
  'hello',
  'snapshot',
  'state',
  'interim',
  'final',
  'reset',
  'command',
  'bye',
]);

const COMMANDS = new Set<Command>(['toggle', 'clear', 'copy', 'focus-main']);

export function isSyncMessage(value: unknown): value is SyncMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !KINDS.has(kind)) return false;
  if (kind !== 'command') return true;
  const command = (value as { command?: unknown }).command;
  return typeof command === 'string' && COMMANDS.has(command as Command);
}

export class SyncBus {
  private readonly channel: ChannelLike;
  private readonly listeners = new Set<(message: SyncMessage) => void>();

  constructor(channel: ChannelLike) {
    this.channel = channel;
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (!isSyncMessage(data)) return;
      for (const listener of [...this.listeners]) listener(data);
    });
  }

  static open(name = CHANNEL_NAME): SyncBus | null {
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
      return new SyncBus(new BroadcastChannel(name));
    } catch {
      return null;
    }
  }

  send(message: SyncMessage): void {
    this.channel.postMessage(message);
  }

  onMessage(listener: (message: SyncMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.listeners.clear();
    this.channel.close();
  }
}
