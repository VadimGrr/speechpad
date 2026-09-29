import type { InsertResult, BridgeReply, WebRequest } from './protocol';
import { describeTarget, isEditableElement, normalizeInsertText } from './protocol';

export interface InserterMessage {
  kind: 'insert';
  text: string;
  seq: number;
}

export function isInserterMessage(value: unknown): value is InserterMessage {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw['kind'] !== 'insert') return false;
  if (typeof raw['text'] !== 'string' || raw['text'].length === 0) return false;
  return typeof raw['seq'] === 'number';
}

export interface InserterDeps {
  window: Window;
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  requestCommand?: (command: string, text: string) => boolean;
}

export function createInserter(deps: InserterDeps) {
  const doc = deps.window.document;
  const last = { element: null as HTMLElement | null };
  let started = false;

  function execInsertText(text: string): boolean {
    const command =
      deps.requestCommand ??
      ((name: string, value: string) => {
        const exec = doc.execCommand;
        if (typeof exec !== 'function') return false;
        return exec.call(doc, name, false, value) === true;
      });
    try {
      return command('insertText', text) === true;
    } catch {
      return false;
    }
  }

  function trackFocus(): void {
    doc.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && isEditableElement(target)) last.element = target;
    });
  }

  function resolveTarget(): HTMLElement | null {
    if (last.element && last.element.isConnected && isEditableElement(last.element)) return last.element;
    const active = doc.activeElement as HTMLElement | null;
    if (active && isEditableElement(active)) return active;
    return null;
  }

  function focusQuietly(element: HTMLElement): void {
    try {
      element.focus({ preventScroll: true });
    } catch {
      try {
        element.focus();
      } catch {
        return;
      }
    }
  }

  function notifyInput(element: HTMLElement, text: string): void {
    const view = element.ownerDocument?.defaultView;
    if (!view) return;
    let event: Event;
    try {
      event = new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text });
    } catch {
      event = new view.Event('input', { bubbles: true });
    }
    element.dispatchEvent(event);
  }

  function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const view = element.ownerDocument?.defaultView;
    if (!view) return;
    const proto = element instanceof HTMLTextAreaElement ? view.HTMLTextAreaElement : view.HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    if (setter) {
      setter.call(element, value);
      return;
    }
    element.value = value;
  }

  function insertIntoValueField(element: HTMLInputElement | HTMLTextAreaElement, text: string): string | null {
    const starts = element.selectionStart ?? element.value.length;
    const ends = element.selectionEnd ?? starts;
    if (typeof element.setRangeText === 'function') {
      try {
        element.setRangeText(text, starts, ends, 'end');
        notifyInput(element, text);
        return 'setRangeText';
      } catch {
        return null;
      }
    }
    const next = element.value.slice(0, starts) + text + element.value.slice(ends);
    setNativeValue(element, next);
    const caret = starts + text.length;
    try {
      element.setSelectionRange(caret, caret);
    } catch {
      return 'native-setter';
    }
    notifyInput(element, text);
    return 'native-setter';
  }

  function insertIntoEditable(element: HTMLElement, text: string): string | null {
    const view = element.ownerDocument?.defaultView;
    const selection = view?.getSelection?.() ?? null;
    if (selection && selection.rangeCount > 0 && element.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      notifyInput(element, text);
      return 'range';
    }
    element.appendChild(doc.createTextNode(text));
    notifyInput(element, text);
    return 'append';
  }

  function insert(text: string): InsertResult {
    const value = normalizeInsertText(text);
    if (!value) {
      return { ok: false, target: null, message: 'пустой текст', strategy: null };
    }
    const target = resolveTarget();
    if (!target) {
      return {
        ok: false,
        target: null,
        message: 'в этой вкладке нет поля ввода — щёлкните по нему один раз',
        strategy: null,
      };
    }
    focusQuietly(target);

    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (execInsertText(value)) return { ok: true, target: describeTarget(target), message: null, strategy: 'execCommand' };
      const fallback = insertIntoValueField(target, value);
      if (fallback) return { ok: true, target: describeTarget(target), message: null, strategy: fallback };
      return { ok: false, target: describeTarget(target), message: 'поле не приняло текст', strategy: null };
    }

    if (execInsertText(value)) return { ok: true, target: describeTarget(target), message: null, strategy: 'execCommand' };
    const fallback = insertIntoEditable(target, value);
    if (fallback) return { ok: true, target: describeTarget(target), message: null, strategy: fallback };
    return { ok: false, target: describeTarget(target), message: 'поле не приняло текст', strategy: null };
  }

  function start(): void {
    if (started) return;
    started = true;
    trackFocus();
  }

  function targetLabel(): string {
    return describeTarget(resolveTarget());
  }

  return { start, insert, targetLabel, lastTarget: resolveTarget };
}

export function replyFor(seq: number, result: InsertResult): BridgeReply {
  return {
    source: 'speechpad-extension',
    kind: 'inserted',
    ok: result.ok,
    seq,
    target: result.target,
    message: result.message,
  };
}

export type { WebRequest };
