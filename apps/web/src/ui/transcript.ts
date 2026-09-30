export type CommitSource = 'append' | 'edit' | 'clear';

export interface TranscriptViewOptions {
  onCommit?: (text: string, source: CommitSource) => void;
}

const GHOST_CLASS = 'ghost';

function caretOffsetOf(root: HTMLElement, container: Node, offset: number): number {
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

function placeCaret(root: HTMLElement, target: number): void {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  const range = doc.createRange();
  const walker = doc.createTreeWalker(root, 4);
  let remaining = target;
  let node = walker.nextNode();
  let placed = false;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
      placed = true;
      break;
    }
    remaining -= length;
    node = walker.nextNode();
  }
  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  const selection = view.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export class TranscriptView {
  private readonly root: HTMLElement;
  private readonly onCommit: (text: string, source: CommitSource) => void;
  private readonly textNode: Text;
  private ghost: HTMLSpanElement | null = null;
  private committed = '';
  private interim = '';
  private frame: number | null = null;
  private readonly handleInput: () => void;
  private readonly handleKeydown: (event: KeyboardEvent) => void;

  constructor(root: HTMLElement, options: TranscriptViewOptions = {}) {
    this.root = root;
    this.onCommit = options.onCommit ?? (() => {});
    this.textNode = document.createTextNode('');
    this.handleInput = () => {
      this.committed = this.root.textContent ?? '';
      this.dropGhost();
      this.paint();
      this.onCommit(this.committed, 'edit');
    };
    this.handleKeydown = (event) => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      this.insertAtCaret('\n');
    };
    this.root.addEventListener('input', this.handleInput);
    this.root.addEventListener('keydown', this.handleKeydown);
    this.paint();
  }

  get text(): string {
    return this.committed;
  }

  releaseFocus(): void {
    const doc = this.root.ownerDocument;
    if (doc.activeElement !== this.root) return;
    doc.defaultView?.getSelection()?.removeAllRanges();
    this.root.blur();
  }

  get interimText(): string {
    return this.interim;
  }

  get displayText(): string {
    return this.interim ? `${this.committed}${this.interim}` : this.committed;
  }

  setText(text: string): void {
    this.committed = text;
    this.interim = '';
    this.cancelFrame();
    this.paint();
  }

  appendFinal(text: string): void {
    const piece = text.trim();
    if (!piece) return;
    this.dropGhost();
    const before = this.committed;
    const spacer = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    this.committed = `${before}${spacer}${piece}`;
    this.paint();
    this.onCommit(this.committed, 'append');
  }

  insertAtCaret(raw: string): void {
    if (!raw) return;
    this.dropGhost();
    const caret = this.readCaret() ?? this.committed.length;
    this.committed = `${this.committed.slice(0, caret)}${raw}${this.committed.slice(caret)}`;
    this.paint();
    placeCaret(this.root, caret + raw.length);
    this.onCommit(this.committed, 'edit');
  }

  setInterim(text: string): void {
    this.interim = text;
    if (this.frame !== null) return;
    const view = this.root.ownerDocument.defaultView;
    const raf = view?.requestAnimationFrame;
    if (!raf) {
      this.paintGhost();
      return;
    }
    this.frame = raf.call(view, () => {
      this.frame = null;
      this.paintGhost();
    });
  }

  flush(): void {
    this.cancelFrame();
    this.paintGhost();
  }

  clear(): void {
    this.committed = '';
    this.interim = '';
    this.cancelFrame();
    this.dropGhost();
    this.paint();
    this.onCommit('', 'clear');
  }

  destroy(): void {
    this.cancelFrame();
    this.root.removeEventListener('input', this.handleInput);
    this.root.removeEventListener('keydown', this.handleKeydown);
  }

  private paint(): void {
    this.textNode.textContent = this.committed;
    this.root.replaceChildren(this.textNode);
    this.paintGhost();
  }

  private paintGhost(): void {
    if (!this.interim) {
      this.dropGhost();
      return;
    }
    if (!this.ghost) {
      this.ghost = document.createElement('span');
      this.ghost.className = GHOST_CLASS;
      this.ghost.setAttribute('aria-hidden', 'true');
    }
    this.ghost.textContent = this.interim;
    this.root.append(this.ghost);
  }

  private dropGhost(): void {
    if (!this.ghost) return;
    this.ghost.remove();
    this.ghost = null;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.root.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readCaret(): number | null {
    const doc = this.root.ownerDocument;
    const selection = doc.defaultView?.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const focused = doc.activeElement === this.root;
    const inside = this.root.contains(selection.anchorNode);
    if (!focused && !inside) return null;
    this.dropGhost();
    return caretOffsetOf(this.root, selection.anchorNode as Node, selection.anchorOffset);
  }
}
