import { describe, expect, it, vi } from 'vitest';
import { createBackground, type InserterReply } from '../src/background';
import type { BrowserApi, MessageSender, Tab } from '../src/chrome-types';

const APP_TAB: Tab = { id: 1, url: 'http://127.0.0.1:8787/' };
const TARGET_TAB: Tab = { id: 2, url: 'https://example.com/chat', active: true };

function sender(url = 'http://127.0.0.1:8787/'): MessageSender {
  return { tab: { id: 1, url } };
}

function harness(options: {
  tabs?: Tab[];
  reply?: InserterReply | Error;
  onSend?: (tabId: number) => void;
} = {}) {
  const tabs = options.tabs ?? [TARGET_TAB];
  const sendMessage = vi.fn(async (tabId: number, _message: unknown) => {
    options.onSend?.(tabId);
    if (options.reply instanceof Error) throw options.reply;
    return options.reply ?? { ok: true, target: 'textarea#msg', message: null, strategy: 'setRangeText' };
  });
  const executeScript = vi.fn(async () => [{}]);
  const badge: string[] = [];
  const api = {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage: vi.fn() },
    tabs: { query: vi.fn(async () => tabs), sendMessage },
    scripting: { executeScript },
    action: {
      setBadgeText: (details: { text: string }) => badge.push(details.text),
      setBadgeBackgroundColor: () => undefined,
    },
  } as unknown as BrowserApi;
  const background = createBackground({ api, insertTimeoutMs: 50 });
  return { background, sendMessage, executeScript, badge, api };
}

const INSERT = { source: 'speechpad-web', kind: 'insert', text: 'привет', seq: 1 };

describe('authorization', () => {
  it('authorizes a local page and reflects it in the badge', async () => {
    const { background, badge } = harness();
    const reply = await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    expect(reply).toEqual({
      source: 'speechpad-extension',
      kind: 'ready',
      authorized: true,
      origins: ['http://127.0.0.1:8787'],
    });
    expect(badge.at(-1)).toBe('ok');
  });

  it('ignores foreign origins', async () => {
    const { background, badge } = harness();
    const reply = await background.handle({ kind: 'bridge-ready', origin: 'https://evil.example', pageId: 'p' }, sender());
    expect(reply).toMatchObject({ authorized: false });
    expect(badge.at(-1)).toBe('off');
  });

  it('ignores a ready message without a page id', async () => {
    const { background } = harness();
    const reply = await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787' }, sender());
    expect(reply).toMatchObject({ kind: 'inserted', ok: false, message: 'неизвестный запрос' });
    expect(await background.handle({ kind: 'web-request', request: { source: 'speechpad-web', kind: 'ping' } }, sender()))
      .toMatchObject({ authorized: false });
  });

  it('keeps the origin authorized while a second local window is open', async () => {
    const { background } = harness();
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'float' }, sender());
    const closingFloat = await background.handle(
      { kind: 'bridge-invalidate', origin: 'http://127.0.0.1:8787', pageId: 'float' },
      sender(),
    );
    expect(closingFloat).toMatchObject({ authorized: true, origins: ['http://127.0.0.1:8787'] });
    const closingMain = await background.handle(
      { kind: 'bridge-invalidate', origin: 'http://127.0.0.1:8787', pageId: 'main' },
      sender(),
    );
    expect(closingMain).toMatchObject({ authorized: false, origins: [] });
  });

  it('revokes authorization when the local page closes', async () => {
    const { background } = harness();
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle(
      { kind: 'bridge-invalidate', origin: 'http://127.0.0.1:8787', pageId: 'main' },
      sender(),
    );
    expect(reply).toMatchObject({ authorized: false, origins: [] });
  });

  it('refuses insert requests from unauthorized senders', async () => {
    const { background, sendMessage } = harness();
    const reply = await background.handle(
      { kind: 'web-request', request: INSERT },
      sender('https://evil.example/'),
    );
    expect(reply).toMatchObject({ ok: false, message: 'вкладка Speechpad не авторизована' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('routing', () => {
  it('sends the fragment to the focused tab', async () => {
    const { background, sendMessage } = harness();
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle({ kind: 'web-request', request: INSERT }, sender());
    expect(sendMessage).toHaveBeenCalledWith(2, { kind: 'insert', text: 'привет', seq: 0 });
    expect(reply).toEqual({
      source: 'speechpad-extension',
      kind: 'inserted',
      ok: true,
      seq: 1,
      target: 'textarea#msg',
      message: null,
    });
  });

  it('refuses to insert into the Speechpad window itself', async () => {
    const { background, sendMessage } = harness({ tabs: [APP_TAB] });
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle({ kind: 'web-request', request: INSERT }, sender());
    expect(reply).toMatchObject({ ok: false, message: 'нет активной вкладки для вставки' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('injects the inserter when the tab has no receiver', async () => {
    let firstCall = true;
    const { background, executeScript } = harness({
      onSend: () => {
        if (firstCall) {
          firstCall = false;
          throw new Error('Receiving end does not exist');
        }
      },
    });
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle({ kind: 'web-request', request: INSERT }, sender());
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 2 }, files: ['inserter.js'] });
    expect(reply).toMatchObject({ ok: true, target: 'textarea#msg' });
  });

  it('reports the inserter failure text', async () => {
    const { background } = harness({ reply: { ok: false, target: null, message: 'вкладка не ответила' } });
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle({ kind: 'web-request', request: INSERT }, sender());
    expect(reply).toMatchObject({ ok: false, message: 'вкладка не ответила' });
  });

  it('turns an exhausted retry into a readable error', async () => {
    const { background } = harness({
      onSend: () => {
        throw new Error('Receiving end does not exist');
      },
    });
    await background.handle({ kind: 'bridge-ready', origin: 'http://127.0.0.1:8787', pageId: 'main' }, sender());
    const reply = await background.handle({ kind: 'web-request', request: INSERT }, sender());
    expect(reply).toMatchObject({ ok: false, message: 'вкладка не отвечает — обновите её и повторите вставку' });
  });
});

describe('protocol', () => {
  it('answers a ping with the current authorization', async () => {
    const { background } = harness();
    const reply = await background.handle({ kind: 'web-request', request: { source: 'speechpad-web', kind: 'ping' } }, sender());
    expect(reply).toMatchObject({ kind: 'ready', authorized: false });
  });

  it('rejects unknown and malformed envelopes', async () => {
    const { background } = harness();
    expect(await background.handle({ kind: 'whatever' }, sender())).toMatchObject({ message: 'неизвестный запрос' });
    expect(await background.handle({ kind: 'web-request', request: { kind: 'nope' } }, sender())).toMatchObject({
      message: 'запрос не распознан',
    });
  });

  it('attaches a runtime listener once', () => {
    const { background, api } = harness();
    background.attach();
    expect(api.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });
});
