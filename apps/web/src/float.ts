import { SyncBus, type Command, type StatePayload, type SyncMessage } from './channel';

const TAIL_CHARS = 700;
const PING_MS = 4000;
const STALE_MS = 10000;

export interface FloatOptions {
  document: Document;
  bus: SyncBus | null;
  now?: () => number;
  openMain?: () => void;
  closeSelf?: () => void;
}

function tail(text: string, limit = TAIL_CHARS): string {
  if (text.length <= limit) return text;
  const cut = text.slice(text.length - limit);
  const space = cut.indexOf(' ');
  return space > 0 ? cut.slice(space + 1) : cut;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const node = doc.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function formatSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class FloatWindow {
  private readonly doc: Document;
  private readonly bus: SyncBus | null;
  private readonly now: () => number;
  private readonly openMain: () => void;
  private readonly closeSelf: () => void;

  private readonly textNode: Text;
  private readonly ghost: HTMLSpanElement;
  private readonly status: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly text: HTMLElement;
  private readonly link: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly copy: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly openMainButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;

  private committed = '';
  private interim = '';
  private payload: StatePayload | null = null;
  private connected = false;
  private lastSeen = 0;
  private linkShown = true;
  private sessionStart = 0;
  private frame: number | null = null;
  private tickTimer: number | null = null;
  private readonly unsubscribe: (() => void) | null;

  constructor(options: FloatOptions) {
    this.doc = options.document;
    this.bus = options.bus;
    this.now = options.now ?? (() => Date.now());
    this.openMain = options.openMain ?? (() => window.open('index.html', '_blank'));
    this.closeSelf = options.closeSelf ?? (() => window.close());

    this.status = byId(this.doc, 'float-status');
    this.timer = byId(this.doc, 'float-timer');
    this.text = byId(this.doc, 'float-text');
    this.link = byId(this.doc, 'float-link');
    this.toggle = byId(this.doc, 'float-toggle');
    this.copy = byId(this.doc, 'float-copy');
    this.clear = byId(this.doc, 'float-clear');
    this.openMainButton = byId(this.doc, 'float-open-main');
    this.closeButton = byId(this.doc, 'float-close');

    this.textNode = this.doc.createTextNode('');
    this.ghost = this.doc.createElement('span');
    this.ghost.className = 'ghost';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.text.replaceChildren(this.textNode);

    this.toggle.addEventListener('click', () => this.command('toggle'));
    this.copy.addEventListener('click', () => this.command('copy'));
    this.clear.addEventListener('click', () => this.command('clear'));
    this.openMainButton.addEventListener('click', () => this.openMain());
    this.closeButton.addEventListener('click', () => this.closeSelf());

    if (this.bus) {
      this.unsubscribe = this.bus.onMessage((message) => this.receive(message));
      this.doc.defaultView?.addEventListener('pagehide', this.handlePageHide);
      this.tickTimer = this.doc.defaultView?.setInterval(() => this.tick(), PING_MS) ?? null;
      this.tick();
    } else {
      this.unsubscribe = null;
    }

    this.render();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get textContent(): string {
    return this.committed;
  }

  tick(): void {
    this.bus?.send({ kind: 'hello' });
    this.evaluateConnection();
    this.renderTimer();
  }

  dispose(): void {
    this.unsubscribe?.();
    if (this.tickTimer !== null) this.doc.defaultView?.clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.doc.defaultView?.removeEventListener('pagehide', this.handlePageHide);
    if (this.frame !== null) this.doc.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly handlePageHide = (): void => {
    this.bus?.send({ kind: 'bye' });
  };

  private command(command: Command): void {
    if (!this.connected) return;
    this.bus?.send({ kind: 'command', command });
  }

  private receive(message: SyncMessage): void {
    this.lastSeen = this.now();
    this.connected = true;
    switch (message.kind) {
      case 'snapshot':
        this.committed = message.text;
        this.interim = '';
        this.payload = message;
        this.applyTheme();
        this.render();
        break;
      case 'state':
        this.payload = message;
        this.applyTheme();
        this.render();
        break;
      case 'interim':
        this.interim = message.text;
        this.schedule();
        break;
      case 'final':
        this.appendFinal(message.text);
        break;
      case 'reset':
        this.committed = '';
        this.interim = '';
        this.render();
        break;
      default:
        return;
    }
    this.evaluateConnection();
  }

  private applyTheme(): void {
    if (this.payload) this.doc.documentElement.dataset['theme'] = this.payload.theme;
  }

  private appendFinal(raw: string): void {
    const piece = raw.trim();
    if (!piece) return;
    this.interim = '';
    const before = this.committed;
    const spacer = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    this.committed = `${before}${spacer}${piece}`;
    this.render();
  }

  private evaluateConnection(): void {
    if (this.connected && this.now() - this.lastSeen > STALE_MS) this.connected = false;
    const showLink = !this.connected;
    if (showLink === this.linkShown) return;
    this.linkShown = showLink;
    this.link.hidden = !showLink;
    this.render();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    const view = this.doc.defaultView;
    const raf = view?.requestAnimationFrame;
    if (!raf) {
      this.render();
      return;
    }
    this.frame = raf.call(view, () => {
      this.frame = null;
      this.render();
    });
  }

  private render(): void {
    this.textNode.textContent = tail(this.committed);
    this.ghost.textContent = this.interim;
    if (this.interim) this.text.append(this.ghost);
    else this.ghost.remove();
    this.text.scrollTop = this.text.scrollHeight;

    const state = this.payload?.state ?? 'idle';
    this.status.dataset['state'] = this.connected ? state : 'offline';
    const label = this.status.querySelector('.label');
    if (label) label.textContent = this.statusLabel(state);

    const hasText = this.committed.trim().length > 0;
    this.toggle.disabled = !(this.connected && (this.payload?.supported ?? false));
    this.copy.disabled = !(this.connected && hasText);
    this.clear.disabled = this.copy.disabled;
    this.toggle.textContent =
      state === 'listening' ? 'Пауза' : state === 'paused' ? 'Продолжить' : 'Слушать';
    this.renderTimer();
  }

  private renderTimer(): void {
    if (this.connected && this.payload?.state === 'listening') {
      if (this.sessionStart === 0) this.sessionStart = this.now();
      this.timer.textContent = formatSpan(this.now() - this.sessionStart);
    } else {
      this.sessionStart = 0;
      this.timer.textContent = '';
    }
  }

  private statusLabel(state: StatePayload['state']): string {
    if (!this.connected) return 'Нет связи с главным окном';
    switch (state) {
      case 'listening':
        return 'Слушаю';
      case 'paused':
        return 'Пауза';
      case 'error':
        return 'Ошибка';
      default:
        return 'Готов';
    }
  }
}
