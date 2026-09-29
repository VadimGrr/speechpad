export const WEB_SOURCE = 'speechpad-web';
export const EXT_SOURCE = 'speechpad-extension';
export const MAX_INSERT_CHARS = 4000;

export interface PingRequest {
  source: typeof WEB_SOURCE;
  kind: 'ping';
}

export interface InsertRequest {
  source: typeof WEB_SOURCE;
  kind: 'insert';
  text: string;
  seq: number;
}

export type WebRequest = PingRequest | InsertRequest;

export interface ReadyReply {
  source: typeof EXT_SOURCE;
  kind: 'ready';
  authorized: boolean;
  origins: string[];
}

export interface InsertedReply {
  source: typeof EXT_SOURCE;
  kind: 'inserted';
  ok: boolean;
  seq: number;
  target: string | null;
  message: string | null;
}

export type BridgeReply = ReadyReply | InsertedReply;

export function isWebRequest(value: unknown): value is WebRequest {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw['source'] !== WEB_SOURCE) return false;
  if (raw['kind'] === 'ping') return true;
  if (raw['kind'] !== 'insert') return false;
  if (typeof raw['text'] !== 'string') return false;
  if (typeof raw['seq'] !== 'number' || !Number.isInteger(raw['seq'])) return false;
  return true;
}

export function isBridgeReply(value: unknown): value is BridgeReply {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw['source'] !== EXT_SOURCE) return false;
  if (raw['kind'] === 'ready') return typeof raw['authorized'] === 'boolean';
  if (raw['kind'] !== 'inserted') return false;
  if (typeof raw['ok'] !== 'boolean') return false;
  return typeof raw['seq'] === 'number';
}

export function isLocalOrigin(origin: string): boolean {
  if (origin === 'null') return false;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export function normalizeInsertText(text: string): string {
  const trimmed = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const trimmedEnd = trimmed.replace(/\s+$/, '');
  if (trimmedEnd.length <= MAX_INSERT_CHARS) return trimmedEnd;
  return trimmedEnd.slice(0, MAX_INSERT_CHARS);
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export function isEditableElement(node: unknown): node is HTMLElement {
  if (typeof node !== 'object' || node === null) return false;
  const element = node as HTMLElement;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) {
    if (element.disabled || element.readOnly) return false;
    return !NON_TEXT_INPUTS.has(element.type);
  }
  if (typeof element.getAttribute !== 'function') return false;
  if (element.getAttribute('contenteditable') === 'false') return false;
  if (element.getAttribute('contenteditable') === 'true') return !element.hasAttribute('disabled');
  if (element.getAttribute('role') === 'textbox') return true;
  return element.isContentEditable === true;
}

export function describeTarget(element: Element | null): string {
  if (!element) return '';
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const name = element.getAttribute('name');
  const hint = element.getAttribute('placeholder') || element.getAttribute('aria-label') || '';
  const parts = [`${tag}${id}`];
  if (name) parts.push(`name=${name}`);
  if (hint) parts.push(hint.length > 24 ? `${hint.slice(0, 24)}…` : hint);
  return parts.join(' ');
}

export interface InsertResult {
  ok: boolean;
  target: string | null;
  message: string | null;
  strategy: string | null;
}
