import { beforeEach, describe, expect, it } from 'vitest';
import { FloatWindow } from '../src/float';
import { SyncBus, type ChannelLike, type SyncMessage, type StatePayload } from '../src/channel';

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

const MARKUP = `
  <div class="float">
    <div class="float-bar">
      <div id="float-status" class="float-status" data-state="offline">
        <span class="dot"></span><span class="label"></span>
        <span id="float-timer" class="float-timer"></span>
      </div>
      <button id="float-toggle" type="button"></button>
      <button id="float-copy" type="button"></button>
      <button id="float-clear" type="button"></button>
      <button id="float-open-main" type="button"></button>
      <button id="float-close" type="button"></button>
    </div>
    <div id="float-text" class="float-text"></div>
    <div id="float-link" class="float-link"><span>нет связи</span></div>
  </div>
`;

let clock = 1000;
let hub: Hub;
let main: SyncBus;
let float: FloatWindow;
let seen: SyncMessage[];

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function payload(overrides: Partial<StatePayload> = {}): StatePayload {
  return { state: 'listening', supported: true, hasText: false, theme: 'dark', ...overrides };
}

function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function heartbeat(times: number, stepMs = 4000): void {
  for (let i = 0; i < times; i += 1) {
    clock += stepMs;
    main.send({ kind: 'state', ...payload() });
    float.tick();
  }
}

function install(): void {
  document.body.innerHTML = MARKUP;
  hub = new Hub();
  main = new SyncBus(hub.create());
  seen = [];
  main.onMessage((message) => seen.push(message));
  float = new FloatWindow({
    document,
    bus: new SyncBus(hub.create()),
    now: () => clock,
    openMain: () => seen.push({ kind: 'command', command: 'focus-main' }),
    closeSelf: () => seen.push({ kind: 'bye' }),
  });
}

describe('FloatWindow', () => {
  beforeEach(() => {
    clock = 1000;
    install();
  });

  it('asks the main window for a snapshot on start', () => {
    expect(seen).toEqual([{ kind: 'hello' }]);
    expect(float.isConnected).toBe(false);
    expect(byId('float-link').hidden).toBe(false);
  });

  it('keeps every remote button dead until the main window answers', () => {
    expect(byId<HTMLButtonElement>('float-toggle').disabled).toBe(true);
    byId<HTMLButtonElement>('float-toggle').click();
    byId<HTMLButtonElement>('float-copy').click();
    byId<HTMLButtonElement>('float-clear').click();
    expect(seen).toEqual([{ kind: 'hello' }]);
  });

  it('hides the link banner and enables listening after the snapshot', () => {
    main.send({ kind: 'snapshot', text: 'начало фразы', ...payload() });
    expect(float.isConnected).toBe(true);
    expect(byId('float-link').hidden).toBe(true);
    expect(byId<HTMLButtonElement>('float-toggle').disabled).toBe(false);
    expect(byId<HTMLButtonElement>('float-toggle').textContent).toBe('Пауза');
    expect(byId('float-status').dataset['state']).toBe('listening');
    expect(byId('float-text').textContent).toBe('начало фразы');
  });

  it('shows the interim text as a ghost inside the tail', async () => {
    main.send({ kind: 'snapshot', text: 'начало', ...payload() });
    main.send({ kind: 'interim', text: ' фразы' });
    await frame();
    expect(byId('float-text').textContent).toBe('начало фразы');
    expect(byId('float-text').querySelector('.ghost')?.textContent).toBe(' фразы');
    main.send({ kind: 'interim', text: '' });
    await frame();
    expect(byId('float-text').querySelector('.ghost')).toBeNull();
  });

  it('keeps only the newest interim inside one frame', async () => {
    main.send({ kind: 'snapshot', text: '', ...payload() });
    main.send({ kind: 'interim', text: 'первый' });
    main.send({ kind: 'interim', text: 'второй' });
    main.send({ kind: 'interim', text: 'третий' });
    await frame();
    expect(byId('float-text').querySelector('.ghost')?.textContent).toBe('третий');
  });

  it('replaces the ghost with the final text', async () => {
    main.send({ kind: 'snapshot', text: 'предыдущая фраза', ...payload() });
    main.send({ kind: 'interim', text: ' начало' });
    await frame();
    main.send({ kind: 'final', text: 'начало фразы' });
    expect(byId('float-text').textContent).toBe('предыдущая фраза начало фразы');
    expect(byId('float-text').querySelector('.ghost')).toBeNull();
    expect(byId<HTMLButtonElement>('float-copy').disabled).toBe(false);
  });

  it('keeps only the tail of a long transcript', () => {
    main.send({ kind: 'snapshot', text: 'слово '.repeat(400), ...payload() });
    const shown = byId('float-text').textContent ?? '';
    expect(shown.length).toBeLessThanOrEqual(700);
    expect(shown.startsWith('слово ')).toBe(true);
    expect(shown.trimEnd().endsWith('слово')).toBe(true);
  });

  it('empties the text on reset', () => {
    main.send({ kind: 'snapshot', text: 'что-то', ...payload() });
    main.send({ kind: 'reset' });
    expect(byId('float-text').textContent).toBe('');
    expect(byId<HTMLButtonElement>('float-copy').disabled).toBe(true);
  });

  it('sends commands for the control buttons', () => {
    main.send({ kind: 'snapshot', text: 'текст', ...payload() });
    seen.length = 0;
    byId<HTMLButtonElement>('float-toggle').click();
    byId<HTMLButtonElement>('float-copy').click();
    byId<HTMLButtonElement>('float-clear').click();
    byId<HTMLButtonElement>('float-open-main').click();
    byId<HTMLButtonElement>('float-close').click();
    expect(seen).toEqual([
      { kind: 'command', command: 'toggle' },
      { kind: 'command', command: 'copy' },
      { kind: 'command', command: 'clear' },
      { kind: 'command', command: 'focus-main' },
      { kind: 'bye' },
    ]);
  });

  it('labels the toggle by the state of the engine', () => {
    main.send({ kind: 'snapshot', text: '', ...payload({ state: 'idle' }) });
    expect(byId<HTMLButtonElement>('float-toggle').textContent).toBe('Слушать');
    main.send({ kind: 'state', ...payload({ state: 'paused' }) });
    expect(byId<HTMLButtonElement>('float-toggle').textContent).toBe('Продолжить');
    main.send({ kind: 'state', ...payload({ state: 'error' }) });
    expect(byId<HTMLButtonElement>('float-toggle').textContent).toBe('Слушать');
    expect(byId('float-status').querySelector('.label')?.textContent).toBe('Ошибка');
  });

  it('keeps the toggle dead when the browser cannot recognise speech', () => {
    main.send({ kind: 'snapshot', text: 'текст', ...payload({ supported: false }) });
    expect(byId<HTMLButtonElement>('float-toggle').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('float-copy').disabled).toBe(false);
  });

  it('follows the theme of the main window', () => {
    main.send({ kind: 'snapshot', text: '', ...payload({ theme: 'light' }) });
    expect(document.documentElement.dataset['theme']).toBe('light');
    main.send({ kind: 'state', ...payload({ theme: 'dark' }) });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('counts the session time while listening', () => {
    main.send({ kind: 'snapshot', text: '', ...payload() });
    expect(byId('float-timer').textContent).toBe('00:00');
    heartbeat(4);
    expect(byId('float-timer').textContent).toBe('00:16');
    main.send({ kind: 'state', ...payload({ state: 'paused' }) });
    expect(byId('float-timer').textContent).toBe('');
  });

  it('shows the offline banner when the main window stops answering', () => {
    main.send({ kind: 'snapshot', text: 'текст', ...payload() });
    expect(byId('float-link').hidden).toBe(true);
    clock += 11_000;
    float.tick();
    expect(float.isConnected).toBe(false);
    expect(byId('float-link').hidden).toBe(false);
    expect(byId('float-status').querySelector('.label')?.textContent).toBe(
      'Нет связи с главным окном',
    );
    expect(byId<HTMLButtonElement>('float-copy').disabled).toBe(true);
  });

  it('tolerates one missed ping', () => {
    main.send({ kind: 'snapshot', text: 'текст', ...payload() });
    clock += 4000;
    float.tick();
    expect(float.isConnected).toBe(true);
    clock += 4000;
    main.send({ kind: 'state', ...payload() });
    float.tick();
    expect(float.isConnected).toBe(true);
  });

  it('comes back online when the main window answers again', () => {
    clock += 11_000;
    float.tick();
    expect(float.isConnected).toBe(false);
    main.send({ kind: 'state', ...payload() });
    expect(float.isConnected).toBe(true);
    expect(byId('float-link').hidden).toBe(true);
  });

  it('sends no commands while offline but keeps local buttons alive', () => {
    main.send({ kind: 'snapshot', text: 'текст', ...payload() });
    clock += 11_000;
    float.tick();
    seen.length = 0;
    byId<HTMLButtonElement>('float-toggle').click();
    byId<HTMLButtonElement>('float-copy').click();
    byId<HTMLButtonElement>('float-clear').click();
    byId<HTMLButtonElement>('float-close').click();
    expect(seen).toEqual([{ kind: 'bye' }]);
    byId<HTMLButtonElement>('float-open-main').click();
    expect(seen).toEqual([{ kind: 'bye' }, { kind: 'command', command: 'focus-main' }]);
  });

  it('stops the heartbeat after dispose', () => {
    float.dispose();
    seen.length = 0;
    clock += 60_000;
    float.tick();
    expect(seen).toEqual([{ kind: 'hello' }]);
  });
});
