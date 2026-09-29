import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInserter, isInserterMessage, replyFor } from '../src/inserter';

function setup(options: { command?: (name: string, text: string) => boolean } = {}) {
  document.body.innerHTML = '';
  const runtime = { sendMessage: vi.fn(async () => undefined) };
  const inserter = createInserter({ window, runtime, requestCommand: options.command ?? (() => false) });
  inserter.start();
  return { inserter, runtime };
}

function field(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector('input, textarea, div') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isInserterMessage', () => {
  it('validates the message shape', () => {
    expect(isInserterMessage({ kind: 'insert', text: 'да', seq: 1 })).toBe(true);
    expect(isInserterMessage({ kind: 'insert', text: '', seq: 1 })).toBe(false);
    expect(isInserterMessage({ kind: 'other' })).toBe(false);
  });
});

describe('replyFor', () => {
  it('builds a bridge reply from the result', () => {
    expect(replyFor(4, { ok: true, target: 'input#a', message: null, strategy: 'setRangeText' })).toEqual({
      source: 'speechpad-extension',
      kind: 'inserted',
      ok: true,
      seq: 4,
      target: 'input#a',
      message: null,
    });
  });
});

describe('insert into a text field', () => {
  it('replaces the selection and fires input', () => {
    const { inserter } = setup();
    const input = field('<input id="a" value="Привет" />') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 6);
    const events: string[] = [];
    input.addEventListener('input', () => events.push(input.value));
    const result = inserter.insert('Пока');
    expect(result).toEqual({ ok: true, target: 'input#a', message: null, strategy: 'setRangeText' });
    expect(input.value).toBe('Пока');
    expect(events).toEqual(['Пока']);
  });

  it('appends when the caret is at the end', () => {
    const { inserter } = setup();
    const area = field('<textarea>Первая строка</textarea>') as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    expect(inserter.insert(' вторая').ok).toBe(true);
    expect(area.value).toBe('Первая строка вторая');
  });

  it('prefers execCommand when the page supports it', () => {
    const command = vi.fn(() => true);
    const { inserter } = setup({ command });
    const input = field('<input value="x" />') as HTMLInputElement;
    input.focus();
    const result = inserter.insert('да');
    expect(result.strategy).toBe('execCommand');
    expect(command).toHaveBeenCalledWith('insertText', 'да');
  });

  it('reports a clear message when nothing was focused', () => {
    const { inserter } = setup();
    const result = inserter.insert('да');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('нет поля ввода');
  });

  it('ignores blank dictation fragments', () => {
    const { inserter } = setup();
    expect(inserter.insert('   ')).toEqual({ ok: false, target: null, message: 'пустой текст', strategy: null });
  });
});

describe('focus tracking', () => {
  it('remembers the last focused field even after focus moves away', () => {
    const { inserter } = setup();
    const input = field('<input id="b" />') as HTMLInputElement;
    const other = document.createElement('button');
    document.body.appendChild(other);
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    other.focus();
    const result = inserter.insert('поздно');
    expect(result.ok).toBe(true);
    expect(result.target).toBe('input#b');
  });

  it('does not track non-editable elements', () => {
    const { inserter } = setup();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(inserter.lastTarget()).toBeNull();
  });
});

describe('insert into contenteditable', () => {
  it('uses the caret range when it is inside the host', () => {
    const { inserter } = setup();
    const host = field('<div id="rich" contenteditable="true">начало</div>') as HTMLElement;
    host.focus();
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const result = inserter.insert(' конец');
    expect(result.ok).toBe(true);
    expect(host.textContent).toBe('начало конец');
  });

  it('appends when the selection lives elsewhere', () => {
    const { inserter } = setup();
    const host = field('<div id="rich" contenteditable="true">начало</div>') as HTMLElement;
    host.focus();
    const outside = document.createElement('p');
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const result = inserter.insert('!');
    expect(result.ok).toBe(true);
    expect(host.textContent).toBe('начало!');
  });
});
