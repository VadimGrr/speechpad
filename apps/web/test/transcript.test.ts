import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptView } from '../src/ui/transcript';

function mount(): { root: HTMLDivElement; view: TranscriptView } {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.tabIndex = 0;
  document.body.replaceChildren(root);
  return { root, view: new TranscriptView(root) };
}

function ghostText(root: HTMLElement): string {
  return root.querySelector('.ghost')?.textContent ?? '';
}

function mountSplit(): { root: HTMLDivElement; interim: HTMLDivElement; view: TranscriptView } {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  root.tabIndex = 0;
  const interim = document.createElement('div');
  document.body.replaceChildren(root, interim);
  return { root, interim, view: new TranscriptView(root, {}, interim) };
}

describe('TranscriptView split panes', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shows the interim text in its own pane, not in the transcript', () => {
    const { root, interim, view } = mountSplit();
    view.appendFinal('подтверждённое');
    view.setInterim('произносимое');
    view.flush();
    expect(interim.textContent).toBe('произносимое');
    expect(root.textContent).toBe('подтверждённое');
  });

  it('moves the text into the transcript once it is final', () => {
    const { root, interim, view } = mountSplit();
    view.setInterim('черновик');
    view.flush();
    expect(interim.textContent).toBe('черновик');
    view.appendFinal('черновик целиком');
    view.setInterim('');
    view.flush();
    expect(interim.textContent).toBe('');
    expect(root.textContent).toBe('черновик целиком');
  });

  it('keeps the interim pane clean between phrases', () => {
    const { interim, view } = mountSplit();
    view.setInterim('первое');
    view.flush();
    view.setInterim('');
    view.flush();
    expect(interim.textContent).toBe('');
  });

  it('empties the interim pane on clear', () => {
    const { interim, view } = mountSplit();
    view.setInterim('ещё говорим');
    view.flush();
    view.clear();
    expect(interim.textContent).toBe('');
  });

  it('never glues the interim pane to the transcript text', () => {
    const { root, interim, view } = mountSplit();
    view.appendFinal('готово');
    view.setInterim('ещё');
    view.flush();
    expect(root.textContent).toBe('готово');
    expect(interim.textContent).toBe('ещё');
  });
});

describe('TranscriptView', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('appends final text with a single separating space', () => {
    const { root, view } = mount();
    view.appendFinal('первая фраза');
    view.appendFinal('вторая фраза');
    expect(root.textContent).toBe('первая фраза вторая фраза');
    expect(view.text).toBe('первая фраза вторая фраза');
  });

  it('ignores empty and whitespace-only fragments', () => {
    const { root, view } = mount();
    view.appendFinal('текст');
    view.appendFinal('   ');
    expect(root.textContent).toBe('текст');
  });

  it('renders interim text inline as a ghost', () => {
    const { root, view } = mount();
    view.appendFinal('начало фразы');
    view.setInterim('и продолжение');
    view.flush();
    expect(root.textContent).toBe('начало фразы и продолжение');
    expect(ghostText(root)).toBe(' и продолжение');
  });

  it('does not add a second space before the ghost', () => {
    const { root, view } = mount();
    view.appendFinal('начало фразы ');
    view.setInterim('продолжение');
    view.flush();
    expect(root.textContent).toBe('начало фразы продолжение');
  });

  it('never doubles a space when the interim already starts with one', () => {
    const { root, view } = mount();
    view.appendFinal('начало');
    view.setInterim(' уже с пробелом');
    view.flush();
    expect(root.textContent).toBe('начало уже с пробелом');
  });

  it('keeps the ghost glued to nothing at the start of an empty transcript', () => {
    const { root, view } = mount();
    view.setInterim('первое слово');
    view.flush();
    expect(root.textContent).toBe('первое слово');
  });

  it('replaces the ghost with the final text', () => {
    const { root, view } = mount();
    view.setInterim('чернови');
    view.flush();
    expect(ghostText(root)).toBe('чернови');
    view.appendFinal('черновик целиком');
    view.setInterim('');
    view.flush();
    expect(root.querySelector('.ghost')).toBeNull();
    expect(root.textContent).toBe('черновик целиком');
  });

  it('keeps only the last interim value inside one animation frame', () => {
    const { root, view } = mount();
    view.setInterim('первый');
    view.setInterim('второй');
    view.setInterim('третий');
    view.flush();
    expect(ghostText(root)).toBe('третий');
  });

  it('appends at the end even when the editor is focused', () => {
    const { root, view } = mount();
    view.setText('слева справа');
    root.focus();
    const textNode = root.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    view.appendFinal('ФРАЗА');
    expect(view.text).toBe('слева справа ФРАЗА');
  });

  it('leaves the caret untouched so a stray selection cannot move text', () => {
    const { view } = mount();
    view.setText('начало');
    const before = window.getSelection()?.rangeCount ?? 0;
    view.appendFinal('ещё');
    expect(view.text).toBe('начало ещё');
    expect(window.getSelection()?.rangeCount ?? 0).toBe(before);
  });

  it('releases focus so the transcript stops being a paste target', () => {
    const { root, view } = mount();
    root.focus();
    expect(document.activeElement).toBe(root);
    view.releaseFocus();
    expect(document.activeElement).not.toBe(root);
  });

  it('keeps manual typing in the middle of the text', () => {
    const { root, view } = mount();
    view.setText('слева справа');
    root.focus();
    const textNode = root.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    view.insertAtCaret('ПРАВКА');
    expect(view.text).toBe('слева ПРАВКАсправа');
  });

  it('adopts manual edits made by the user', () => {
    const { root, view } = mount();
    const changes: string[] = [];
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.replaceChildren(editable);
    const live = new TranscriptView(editable, {
      onCommit: (text) => changes.push(text),
    });
    editable.textContent = 'правка вручную';
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    expect(live.text).toBe('правка вручную');
    expect(changes.at(-1)).toBe('правка вручную');
    expect(root.isConnected).toBe(false);
  });

  it('keeps newlines typed by the user as plain text', () => {
    const { root, view } = mount();
    root.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    view.appendFinal('строка один');
    expect(view.text).toBe('\nстрока один');
    expect(root.querySelectorAll('div')).toHaveLength(0);
  });

  it('reports every change to the owner of the view', () => {
    const changes: string[] = [];
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const view = new TranscriptView(root, { onCommit: (t) => changes.push(t) });
    view.appendFinal('раз');
    view.clear();
    expect(changes).toEqual(['раз', '']);
  });

  it('stops listening after destroy', () => {
    const { root, view } = mount();
    view.destroy();
    view.setText('до уничтожения');
    root.textContent = 'после уничтожения';
    root.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.text).toBe('до уничтожения');
  });

  it('does not schedule a frame when rAF is missing', () => {
    const { root, view } = mount();
    const original = window.requestAnimationFrame;
    vi.stubGlobal('requestAnimationFrame', undefined);
    window.requestAnimationFrame = undefined as unknown as typeof window.requestAnimationFrame;
    view.setInterim('мгновенно');
    expect(ghostText(root)).toBe('мгновенно');
    window.requestAnimationFrame = original;
  });
});
