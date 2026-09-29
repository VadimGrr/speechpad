import type { Clock } from './clock.js';
import type { RecognitionFactory } from './webSpeech.js';

export type PublicState = 'idle' | 'listening' | 'paused' | 'error';

export type InternalState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'paused'
  | 'restarting'
  | 'error';

export type RestartReason = 'start' | 'end' | 'watchdog' | 'error' | 'recycle' | 'lang';

export type DedupeReason =
  | 'empty'
  | 'suffix-overlap'
  | 'exact-tail'
  | 'contained-in-tail'
  | 'recent-repeat';

export interface DedupeOptions {
  tailWindowChars: number;
  minOverlapChars: number;
  minDropChars: number;
  minContainChars: number;
  stripPunctuation: boolean;
  lowercase: boolean;
  yoAsE: boolean;
  collapseWhitespace: boolean;
}

export interface SpeechEngineOptions {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  restartDelayMs: number;
  maxRestartDelayMs: number;
  silentEndLimit: number;
  silentEndDelayMs: number;
  minRestartGapMs: number;
  watchdogMs: number;
  watchdogCooldownMs: number;
  watchdogMaxMs: number;
  watchdogCheckMs: number;
  recycleAfterMs: number;
  recycleQuietMs: number;
  dedupe: Partial<DedupeOptions>;
  clock: Clock;
  factory: RecognitionFactory;
}

export type PartialEvent = { text: string; at: number };

export type FinalEvent = {
  text: string;
  at: number;
  dropped: boolean;
  reason: DedupeReason | null;
};

export type StateEvent = { state: PublicState; previous: PublicState };

export type ErrorEvent = {
  code: string;
  fatal: boolean;
  message: string;
  at: number;
};

export type RestartEvent = {
  reason: RestartReason;
  delayMs: number;
  attempt: number;
  at: number;
};

export type Metrics = {
  restarts: number;
  watchdogRestarts: number;
  recycles: number;
  silentEnds: number;
  duplicatesBlocked: number;
  finals: number;
  lastResultAt: number;
  lastRestartAt: number;
  startedAt: number;
  firstInterimAfterStartMs: number | null;
  lastInterimAfterRestartMs: number | null;
  avgInterimIntervalMs: number | null;
  maxSilenceGapMs: number;
  state: PublicState;
};

export interface EngineEventMap {
  partial: PartialEvent;
  final: FinalEvent;
  state: StateEvent;
  error: ErrorEvent;
  restart: RestartEvent;
  metrics: Metrics;
}

export const DEFAULT_DEDUPE: DedupeOptions = {
  tailWindowChars: 200,
  minOverlapChars: 4,
  minDropChars: 5,
  minContainChars: 12,
  stripPunctuation: true,
  lowercase: true,
  yoAsE: true,
  collapseWhitespace: true,
};

export const DEFAULT_OPTIONS: Omit<SpeechEngineOptions, 'clock' | 'factory'> = {
  lang: 'ru-RU',
  continuous: true,
  interimResults: true,
  maxAlternatives: 1,
  restartDelayMs: 400,
  maxRestartDelayMs: 3000,
  silentEndLimit: 3,
  silentEndDelayMs: 1500,
  minRestartGapMs: 300,
  watchdogMs: 12_000,
  watchdogCooldownMs: 5000,
  watchdogMaxMs: 60_000,
  watchdogCheckMs: 1000,
  recycleAfterMs: 25 * 60_000,
  recycleQuietMs: 1500,
  dedupe: DEFAULT_DEDUPE,
};

export const FATAL_ERRORS: ReadonlySet<string> = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
]);

export const RETRYABLE_ERRORS: ReadonlySet<string> = new Set([
  'network',
  'no-speech',
  'aborted',
  'unknown',
]);

export const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'not-allowed': 'Доступ к микрофону запрещён. Разрешите микрофон в настройках браузера.',
  'service-not-allowed': 'Браузер запретил сервис распознавания. Проверьте настройки микрофона.',
  'audio-capture': 'Микрофон не найден или недоступен.',
  'language-not-supported': 'Выбранный язык не поддерживается распознаванием.',
  network: 'Нет связи с сервисом распознавания, будет попытка переподключения.',
  'no-speech': 'Речь не обнаружена, продолжаю слушать.',
  aborted: 'Сеанс распознавания прерван, восстанавливаю.',
  'InvalidStateError': 'Распознаватель уже запущен, повторю запуск.',
  'not-supported': 'Браузер не поддерживает Web Speech API. Откройте в Chrome или Edge.',
  'insecure-context': 'Нужен защищённый контекст: localhost или https.',
  unknown: 'Непредвиденная ошибка распознавания.',
};
