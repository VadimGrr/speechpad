import { Emitter, type Unsubscribe } from './bus.js';
import { systemClock, type TimerId } from './clock.js';
import { dedupeFragment, isRecentRepeat, normalizeForCompare } from './dedupe.js';
import { RestartPlanner, watchdogThreshold } from './planner.js';
import {
  DEFAULT_DEDUPE,
  DEFAULT_OPTIONS,
  ERROR_MESSAGES,
  FATAL_ERRORS,
  type EngineEventMap,
  type ErrorEvent,
  type FinalEvent,
  type InternalState,
  type Metrics,
  type PublicState,
  type RestartReason,
  type SpeechEngineOptions,
} from './types.js';
import {
  createWebSpeechFactory,
  defaultScope,
  type BrowserScope,
  type RecognitionLike,
} from './webSpeech.js';

const PUBLIC_STATE: Record<InternalState, PublicState> = {
  idle: 'idle',
  starting: 'listening',
  listening: 'listening',
  paused: 'paused',
  restarting: 'listening',
  error: 'error',
};

const MAX_RECENT_FINALS = 8;
const MAX_INTERVAL_SAMPLES = 100;
const END_FALLBACK_MS = 1500;

function asErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = /ERROR:([a-zA-Z-]+)/.exec(error.message);
    if (match?.[1]) return match[1];
    if (error.name) return error.name;
  }
  if (typeof error === 'string') {
    const match = /ERROR:([a-zA-Z-]+)/.exec(error);
    if (match?.[1]) return match[1];
    return error;
  }
  return 'unknown';
}

export type SpeechEngineConfig = Partial<SpeechEngineOptions> &
  { scope?: BrowserScope };

export class SpeechEngine {
  private readonly options: SpeechEngineOptions;
  private readonly emitter = new Emitter<EngineEventMap>();
  private readonly planner: RestartPlanner;
  private readonly dedupeOptions;

  private recognizer: RecognitionLike | null = null;
  private sessionId = 0;
  private wantRecord = false;
  private internal: InternalState = 'idle';
  private endSeen = true;

  private restartTimer: TimerId | null = null;
  private watchdogTimer: TimerId | null = null;

  private transcript = '';
  private interim = '';
  private recentFinals: string[] = [];
  private intervalSamples: number[] = [];

  private startedAt = 0;
  private sessionStartedAt = 0;
  private lastResultAt = 0;
  private lastRestartAt = 0;
  private lastInterimAt = 0;
  private hasResultInSession = false;
  private noResultStreak = 0;
  private firstResultAfterStartMs: number | null = null;
  private lastResultAfterRestartMs: number | null = null;
  private maxSilenceGapMs = 0;

  private restarts = 0;
  private watchdogRestarts = 0;
  private recycles = 0;
  private silentEnds = 0;
  private duplicatesBlocked = 0;
  private finals = 0;

  constructor(config: SpeechEngineConfig = {}) {
    const { scope, ...rest } = config;
    const merged = {
      ...DEFAULT_OPTIONS,
      ...rest,
      dedupe: { ...DEFAULT_DEDUPE, ...(rest.dedupe ?? {}) },
      clock: rest.clock ?? systemClock,
      factory: rest.factory ?? createWebSpeechFactory(scope ?? defaultScope()),
    };
    this.options = merged as SpeechEngineOptions;
    this.dedupeOptions = merged.dedupe;
    this.planner = new RestartPlanner({
      baseDelayMs: merged.restartDelayMs,
      maxDelayMs: merged.maxRestartDelayMs,
      minRestartGapMs: merged.minRestartGapMs,
      silentEndLimit: merged.silentEndLimit,
      silentEndDelayMs: merged.silentEndDelayMs,
    });
  }

  get state(): PublicState {
    return PUBLIC_STATE[this.internal];
  }

  get internalState(): InternalState {
    return this.internal;
  }

  get isSupported(): boolean {
    return this.options.factory.available;
  }

  get unsupportedReason(): string | null {
    return this.options.factory.reason;
  }

  get lang(): string {
    return this.options.lang;
  }

  get transcriptText(): string {
    return this.transcript;
  }

  get interimText(): string {
    return this.interim;
  }

  get isRunning(): boolean {
    return this.wantRecord;
  }

  on<K extends keyof EngineEventMap>(
    type: K,
    listener: (payload: EngineEventMap[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  once<K extends keyof EngineEventMap>(
    type: K,
    listener: (payload: EngineEventMap[K]) => void,
  ): Unsubscribe {
    return this.emitter.once(type, listener);
  }

  off<K extends keyof EngineEventMap>(
    type: K,
    listener: (payload: EngineEventMap[K]) => void,
  ): void {
    this.emitter.off(type, listener);
  }

  start(): void {
    if (this.wantRecord) return;
    this.wantRecord = true;
    const now = this.options.clock.now();
    if (this.startedAt === 0) this.startedAt = now;
    this.planner.reset();
    this.noResultStreak = 0;
    this.setInternal('starting');
    this.spawn();
    this.startWatchdog();
  }

  pause(): void {
    if (!this.wantRecord) return;
    this.wantRecord = false;
    this.clearTimers();
    this.teardown();
    this.setInterim('');
    this.setInternal('paused');
  }

  stop(): void {
    this.wantRecord = false;
    this.clearTimers();
    this.teardown();
    this.setInterim('');
    this.planner.reset();
    this.noResultStreak = 0;
    this.setInternal('idle');
  }

  toggle(): void {
    if (this.wantRecord) this.pause();
    else this.start();
  }

  clear(): void {
    this.transcript = '';
    this.recentFinals = [];
    this.intervalSamples = [];
    this.setInterim('');
  }

  setLang(lang: string): void {
    if (!lang || lang === this.options.lang) return;
    this.options.lang = lang;
    if (!this.wantRecord) return;
    this.clearRestartTimer();
    this.teardown();
    this.setInterim('');
    this.setInternal('restarting');
    this.restartTimer = this.options.clock.setTimeout(() => {
      this.restartTimer = null;
      this.lastRestartAt = this.options.clock.now();
      if (!this.wantRecord) return;
      this.spawn();
      this.restarts += 1;
      this.emitter.emit('restart', {
        reason: 'lang',
        delayMs: 0,
        attempt: 0,
        at: this.lastRestartAt,
      });
      this.emitMetrics();
    }, 200);
  }

  syncTranscript(text: string): void {
    if (text === this.transcript) return;
    this.transcript = text;
    this.recentFinals = [];
  }

  metrics(): Metrics {
    const sum = this.intervalSamples.reduce((a, b) => a + b, 0);
    return {
      restarts: this.restarts,
      watchdogRestarts: this.watchdogRestarts,
      recycles: this.recycles,
      silentEnds: this.silentEnds,
      duplicatesBlocked: this.duplicatesBlocked,
      finals: this.finals,
      lastResultAt: this.lastResultAt,
      lastRestartAt: this.lastRestartAt,
      startedAt: this.startedAt,
      firstInterimAfterStartMs: this.firstResultAfterStartMs,
      lastInterimAfterRestartMs: this.lastResultAfterRestartMs,
      avgInterimIntervalMs:
        this.intervalSamples.length > 0
          ? Math.round(sum / this.intervalSamples.length)
          : null,
      maxSilenceGapMs: this.maxSilenceGapMs,
      state: this.state,
    };
  }

  dispose(): void {
    this.wantRecord = false;
    this.clearTimers();
    this.teardown();
    this.setInterim('');
    this.setInternal('idle');
    this.emitter.clear();
  }

  private setInternal(next: InternalState): void {
    if (this.internal === next) return;
    const previous = this.state;
    this.internal = next;
    const state = this.state;
    if (state !== previous) {
      this.emitter.emit('state', { state, previous });
    }
    this.emitMetrics();
  }

  private spawn(): void {
    if (!this.wantRecord) return;
    const factory = this.options.factory;
    if (!factory.available) {
      this.fail(factory.reason ?? 'not-supported');
      return;
    }

    const now = this.options.clock.now();
    const id = ++this.sessionId;
    this.sessionStartedAt = now;
    this.lastResultAt = now;
    this.hasResultInSession = false;
    this.endSeen = false;

    let recognizer: RecognitionLike;
    try {
      recognizer = factory.create();
    } catch (error) {
      this.onStartFailure(asErrorCode(error));
      return;
    }

    recognizer.continuous = this.options.continuous;
    recognizer.interimResults = this.options.interimResults;
    recognizer.lang = this.options.lang;
    recognizer.maxAlternatives = this.options.maxAlternatives;

    recognizer.onstart = () => {
      if (id !== this.sessionId) return;
      this.setInternal('listening');
    };

    recognizer.onresult = (event) => {
      if (id !== this.sessionId) return;
      this.handleResult(event, id);
    };

    recognizer.onerror = (event) => {
      if (id !== this.sessionId) return;
      this.handleError(event.error || 'unknown');
    };

    recognizer.onend = () => {
      if (id !== this.sessionId) return;
      this.handleEnd();
    };

    this.recognizer = recognizer;

    try {
      recognizer.start();
    } catch (error) {
      this.onStartFailure(asErrorCode(error));
    }
  }

  private onStartFailure(code: string): void {
    if (code === 'not-supported' || code === 'insecure-context') {
      this.fail(code);
      return;
    }
    this.scheduleRestart('error', false);
  }

  private handleResult(
    event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } } } },
    id: number,
  ): void {
    const now = this.options.clock.now();
    if (id !== this.sessionId) return;

    if (!this.hasResultInSession) {
      this.lastResultAfterRestartMs = now - this.sessionStartedAt;
      if (this.firstResultAfterStartMs === null) {
        this.firstResultAfterStartMs = now - this.startedAt;
      }
    }

    if (this.lastResultAt > 0) {
      const gap = now - this.lastResultAt;
      if (gap > this.maxSilenceGapMs) this.maxSilenceGapMs = gap;
      if (this.lastInterimAt > 0) {
        this.intervalSamples.push(gap);
        if (this.intervalSamples.length > MAX_INTERVAL_SAMPLES) {
          this.intervalSamples.shift();
        }
      }
    }
    this.lastResultAt = now;
    this.lastInterimAt = now;
    this.hasResultInSession = true;
    this.noResultStreak = 0;
    this.planner.noteResult();

    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) this.commitFinal(text, now);
      else interim += text;
    }

    this.setInterim(interim);
    this.emitMetrics();
  }

  private commitFinal(text: string, now: number): void {
    const normalized = normalizeForCompare(text, this.dedupeOptions);
    if (
      isRecentRepeat(
        normalized,
        this.recentFinals,
        this.dedupeOptions.minDropChars,
      )
    ) {
      this.duplicatesBlocked += 1;
      this.emitter.emit('final', {
        text: '',
        at: now,
        dropped: true,
        reason: 'recent-repeat',
      } satisfies FinalEvent);
      return;
    }

    const result = dedupeFragment(text, this.transcript, this.dedupeOptions);
    if (result.dropped) {
      this.duplicatesBlocked += 1;
      this.emitter.emit('final', {
        text: '',
        at: now,
        dropped: true,
        reason: result.reason,
      } satisfies FinalEvent);
      return;
    }

    this.appendToTranscript(result.text);
    this.recentFinals.push(normalizeForCompare(result.text, this.dedupeOptions));
    if (this.recentFinals.length > MAX_RECENT_FINALS) this.recentFinals.shift();
    this.finals += 1;
    this.emitter.emit('final', {
      text: result.text,
      at: now,
      dropped: false,
      reason: null,
    } satisfies FinalEvent);
  }

  private handleError(code: string): void {
    if (FATAL_ERRORS.has(code)) {
      this.fail(code);
      return;
    }
    const event: ErrorEvent = {
      code,
      fatal: false,
      message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES['unknown'] ?? code,
      at: this.options.clock.now(),
    };
    this.emitter.emit('error', event);
    this.armEndFallback();
  }

  private fail(code: string): void {
    const now = this.options.clock.now();
    this.wantRecord = false;
    this.clearTimers();
    this.teardown();
    this.setInterim('');
    this.emitter.emit('error', {
      code,
      fatal: true,
      message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES['unknown'] ?? code,
      at: now,
    } satisfies ErrorEvent);
    this.setInternal('error');
  }

  private handleEnd(): void {
    const hadResult = this.hasResultInSession;
    this.hasResultInSession = false;
    this.endSeen = true;
    this.silentEnds += 1;
    this.setInterim('');
    if (!this.wantRecord) return;
    this.scheduleRestart('end', hadResult);
  }

  private armEndFallback(): void {
    if (this.restartTimer !== null) return;
    this.restartTimer = this.options.clock.setTimeout(() => {
      this.restartTimer = null;
      if (!this.wantRecord || this.endSeen) return;
      this.scheduleRestart('error', false);
    }, END_FALLBACK_MS);
  }

  private scheduleRestart(
    reason: RestartReason,
    hadResult: boolean,
  ): void {
    if (!this.wantRecord) return;
    this.clearRestartTimer();
    const now = this.options.clock.now();
    const decision = this.planner.decide({
      now,
      wantRecord: this.wantRecord,
      hadResult,
      reason,
    });
    if (decision.action === 'stop') return;

    this.setInternal('restarting');
    this.noResultStreak += 1;
    if (reason === 'watchdog') this.watchdogRestarts += 1;
    if (reason === 'recycle') this.recycles += 1;

    this.restartTimer = this.options.clock.setTimeout(() => {
      this.restartTimer = null;
      const at = this.options.clock.now();
      this.lastRestartAt = at;
      if (!this.wantRecord) return;
      this.teardown();
      this.spawn();
      this.restarts += 1;
      this.emitter.emit('restart', {
        reason,
        delayMs: decision.delayMs,
        attempt: decision.attempt,
        at,
      });
      this.emitMetrics();
    }, decision.delayMs);
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = this.options.clock.setInterval(
      () => this.tick(),
      this.options.watchdogCheckMs,
    );
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer === null) return;
    this.options.clock.clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private tick(): void {
    if (!this.wantRecord || !this.recognizer) return;
    const now = this.options.clock.now();
    const silence = now - this.lastResultAt;
    if (silence > this.maxSilenceGapMs) this.maxSilenceGapMs = silence;

    if (
      now - this.sessionStartedAt >= this.options.recycleAfterMs &&
      silence >= this.options.recycleQuietMs
    ) {
      this.scheduleRestart('recycle', this.hasResultInSession);
      return;
    }

    const threshold = watchdogThreshold(
      this.options.watchdogMs,
      this.noResultStreak,
      this.options.watchdogMaxMs,
    );
    if (
      silence > threshold &&
      now - this.lastRestartAt >= this.options.watchdogCooldownMs
    ) {
      this.scheduleRestart('watchdog', this.hasResultInSession);
    }
  }

  private appendToTranscript(piece: string): void {
    const trimmed = piece.trim();
    if (!trimmed) return;
    const needsSpace = this.transcript.length > 0 && !/\s$/.test(this.transcript);
    this.transcript += `${needsSpace ? ' ' : ''}${trimmed}`;
  }

  private setInterim(text: string): void {
    if (this.interim === text) return;
    this.interim = text;
    this.emitter.emit('partial', { text, at: this.options.clock.now() });
  }

  private teardown(): void {
    const recognizer = this.recognizer;
    this.recognizer = null;
    this.sessionId += 1;
    if (!recognizer) return;
    recognizer.onstart = null;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    try {
      recognizer.abort();
    } catch {
      return;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer === null) return;
    this.options.clock.clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearTimers(): void {
    this.clearRestartTimer();
    this.stopWatchdog();
  }

  private emitMetrics(): void {
    this.emitter.emit('metrics', this.metrics());
  }
}
