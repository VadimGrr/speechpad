import { Emitter, type Unsubscribe } from './bus.js';
import { SpeechEngine, type SpeechEngineConfig } from './engine.js';
import type {
  ErrorEvent,
  FinalEvent,
  Metrics,
  PublicState,
  RestartReason,
  SpeechEngineOptions,
} from './types.js';

export type SdkPayloads = {
  partial: string;
  final: string;
  duplicate: { text: string; reason: string | null };
  state: PublicState;
  error: ErrorEvent;
  restart: { reason: RestartReason; delayMs: number; attempt: number };
  metrics: Metrics;
};

export type SdkEventMap = {
  [K in keyof SdkPayloads]: (payload: SdkPayloads[K]) => void;
};

export type SdkEventName = keyof SdkPayloads;

export class SpeechpadEngine {
  private readonly engine: SpeechEngine;
  private readonly emitter = new Emitter<SdkPayloads>();

  constructor(options: Partial<SpeechEngineOptions> & SpeechEngineConfig = {}) {
    this.engine = new SpeechEngine(options);
    this.engine.on('partial', (event) => this.emitter.emit('partial', event.text));
    this.engine.on('final', (event: FinalEvent) => {
      if (event.dropped) {
        this.emitter.emit('duplicate', { text: '', reason: event.reason });
        return;
      }
      this.emitter.emit('final', event.text);
    });
    this.engine.on('state', (event) => this.emitter.emit('state', event.state));
    this.engine.on('error', (event) => this.emitter.emit('error', event));
    this.engine.on('restart', (event) =>
      this.emitter.emit('restart', {
        reason: event.reason,
        delayMs: event.delayMs,
        attempt: event.attempt,
      }),
    );
    this.engine.on('metrics', (event) => this.emitter.emit('metrics', event));
  }

  static isSupported(scope?: SpeechEngineConfig['scope']): boolean {
    return new SpeechEngine(scope ? { scope } : {}).isSupported;
  }

  get state(): PublicState {
    return this.engine.state;
  }

  get isSupported(): boolean {
    return this.engine.isSupported;
  }

  get unsupportedReason(): string | null {
    return this.engine.unsupportedReason;
  }

  get transcript(): string {
    return this.engine.transcriptText;
  }

  get interim(): string {
    return this.engine.interimText;
  }

  get metrics(): Metrics {
    return this.engine.metrics();
  }

  get lang(): string {
    return this.engine.lang;
  }

  on<K extends SdkEventName>(type: K, handler: SdkEventMap[K]): Unsubscribe {
    return this.emitter.on(type, handler);
  }

  off<K extends SdkEventName>(type: K, handler: SdkEventMap[K]): void {
    this.emitter.off(type, handler);
  }

  start(): void {
    this.engine.start();
  }

  pause(): void {
    this.engine.pause();
  }

  stop(): void {
    this.engine.stop();
  }

  toggle(): void {
    this.engine.toggle();
  }

  clear(): void {
    this.engine.clear();
  }

  setLang(lang: string): void {
    this.engine.setLang(lang);
  }

  syncTranscript(text: string): void {
    this.engine.syncTranscript(text);
  }

  destroy(): void {
    this.engine.dispose();
    this.emitter.clear();
  }
}

export function createEngine(
  options: Partial<SpeechEngineOptions> & SpeechEngineConfig = {},
): SpeechpadEngine {
  return new SpeechpadEngine(options);
}
