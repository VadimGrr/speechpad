import type { BrowserApi, MessageSender, Tab } from './chrome-types';
import { isLocalOrigin, isWebRequest, EXT_SOURCE, type BridgeReply } from './protocol';

export interface BackgroundDeps {
  api: BrowserApi;
  insertTimeoutMs?: number;
}

export interface InserterReply {
  ok?: boolean;
  target?: string | null;
  message?: string | null;
  strategy?: string | null;
}

const LOCAL_URL = 'http://127.0.0.1/*';

export function createBackground(deps: BackgroundDeps) {
  const api = deps.api;
  const pages = new Map<string, Set<string>>();
  const timeoutMs = deps.insertTimeoutMs ?? 3000;

  function origins(): string[] {
    return [...pages.keys()];
  }

  function authorized(): boolean {
    return pages.size > 0;
  }

  function setBadge(): void {
    const action = api.action;
    if (!action) return;
    const text = authorized() ? 'ok' : 'off';
    void Promise.resolve(action.setBadgeText({ text })).catch(() => undefined);
    void Promise.resolve(action.setBadgeBackgroundColor?.({ color: text === 'ok' ? '#1f9d55' : '#6b7280' })).catch(
      () => undefined,
    );
  }

  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(label));
        },
      );
    });
  }

  function senderOrigin(sender: MessageSender): string | null {
    const raw = sender.tab?.url ?? sender.url ?? null;
    if (!raw) return null;
    try {
      return new URL(raw).origin;
    } catch {
      return null;
    }
  }

  async function targetTab(excludeTabId: number | undefined): Promise<Tab | null> {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs.find((item) => item.id !== undefined && item.id !== excludeTabId) ?? null;
    return tab;
  }

  async function deliver(tabId: number, text: string): Promise<InserterReply> {
    const payload = { kind: 'insert', text, seq: 0 };
    try {
      const response = await withTimeout(api.tabs.sendMessage(tabId, payload), timeoutMs, 'вставка');
      if (response && typeof response === 'object') return response as InserterReply;
      return { ok: false, message: 'вкладка не ответила' };
    } catch {
      try {
        await api.scripting.executeScript({ target: { tabId }, files: ['inserter.js'] });
        const retry = await withTimeout(api.tabs.sendMessage(tabId, payload), timeoutMs, 'вставка');
        return (retry ?? { ok: false, message: 'вкладка не ответила' }) as InserterReply;
      } catch {
        throw new Error('вкладка не отвечает — обновите её и повторите вставку');
      }
    }
  }

  async function handle(request: unknown, sender: MessageSender): Promise<BridgeReply> {
    const record = request as { kind?: unknown; origin?: unknown; pageId?: unknown } | null;
    const kind = record?.kind;

    if (kind === 'bridge-ready' && typeof record?.origin === 'string' && typeof record.pageId === 'string') {
      if (isLocalOrigin(record.origin)) {
        const known = pages.get(record.origin) ?? new Set<string>();
        known.add(record.pageId);
        pages.set(record.origin, known);
      }
      setBadge();
      return ready();
    }
    if (kind === 'bridge-invalidate' && typeof record?.origin === 'string' && typeof record.pageId === 'string') {
      const known = pages.get(record.origin);
      if (known) {
        known.delete(record.pageId);
        if (known.size === 0) pages.delete(record.origin);
      }
      setBadge();
      return ready();
    }
    if (kind !== 'web-request') {
      return { source: EXT_SOURCE, kind: 'inserted', ok: false, seq: 0, target: null, message: 'неизвестный запрос' };
    }

    const payload = (record as { request?: unknown }).request;
    if (!isWebRequest(payload)) {
      return { source: EXT_SOURCE, kind: 'inserted', ok: false, seq: 0, target: null, message: 'запрос не распознан' };
    }
    if (payload.kind === 'ping') return ready();

    const origin = senderOrigin(sender);
    if (!origin || !pages.has(origin)) {
      return {
        source: EXT_SOURCE,
        kind: 'inserted',
        ok: false,
        seq: payload.seq,
        target: null,
        message: 'вкладка Speechpad не авторизована',
      };
    }

    const tab = await targetTab(sender.tab?.id);
    if (!tab?.id) {
      return {
        source: EXT_SOURCE,
        kind: 'inserted',
        ok: false,
        seq: payload.seq,
        target: null,
        message: 'нет активной вкладки для вставки',
      };
    }
    try {
      const result = await deliver(tab.id, payload.text);
      return {
        source: EXT_SOURCE,
        kind: 'inserted',
        ok: result.ok === true,
        seq: payload.seq,
        target: result.target ?? null,
        message: result.ok === true ? null : (result.message ?? 'вставка не выполнена'),
      };
    } catch (error) {
      return {
        source: EXT_SOURCE,
        kind: 'inserted',
        ok: false,
        seq: payload.seq,
        target: null,
        message: error instanceof Error ? error.message : 'вставка не выполнена',
      };
    }
  }

  function ready(): BridgeReply {
    return { source: EXT_SOURCE, kind: 'ready', authorized: authorized(), origins: origins() };
  }

  function attach(): void {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      void handle(message, sender).then(sendResponse, () => sendResponse(undefined));
      return true;
    });
  }

  return { attach, handle, pages, ready };
}

export const HOST_PERMISSION = LOCAL_URL;
