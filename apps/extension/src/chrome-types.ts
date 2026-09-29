export interface BrowserEvent<T extends (...args: never[]) => void> {
  addListener(listener: T): void;
  removeListener(listener: T): void;
}

export interface Tab {
  id?: number;
  url?: string;
  active?: boolean;
  windowId?: number;
}

export interface MessageSender {
  tab?: Tab;
  url?: string;
}

export interface RuntimeApi {
  lastError?: { message?: string } | undefined;
  onMessage: BrowserEvent<
    (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void
  >;
  sendMessage(message: unknown): Promise<unknown>;
}

export interface TabsApi {
  query(info: { active?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface ScriptingApi {
  executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown[]>;
}

export interface ActionApi {
  setBadgeText(details: { text: string }): Promise<void> | void;
  setBadgeBackgroundColor(details: { color: string }): Promise<void> | void;
}

export interface BrowserApi {
  runtime: RuntimeApi;
  tabs: TabsApi;
  scripting: ScriptingApi;
  action?: ActionApi;
}

export function getBrowserApi(scope: unknown = globalThis): BrowserApi {
  const holder = scope as { chrome?: BrowserApi } | null | undefined;
  const api = holder?.chrome;
  if (!api?.runtime || !api.tabs || !api.scripting) {
    throw new Error('Chrome API недоступен');
  }
  return api;
}

export function runtimeError(api: RuntimeApi): string | null {
  const error = api.lastError;
  if (!error) return null;
  return error.message ?? 'ошибка расширения';
}
