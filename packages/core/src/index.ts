export { SpeechEngine } from './engine.js';
export type { SpeechEngineConfig } from './engine.js';
export { SpeechpadEngine, createEngine } from './sdk.js';
export type { SdkEventMap, SdkEventName } from './sdk.js';
export {
  createWebSpeechFactory,
  defaultScope,
  isSecureContextLike,
} from './webSpeech.js';
export type {
  BrowserScope,
  RecognitionCtor,
  RecognitionFactory,
  RecognitionLike,
} from './webSpeech.js';
export {
  dedupeFragment,
  isRecentRepeat,
  normalizeForCompare,
} from './dedupe.js';
export type { DedupeResult } from './dedupe.js';
export { RestartPlanner, watchdogThreshold } from './planner.js';
export { Emitter } from './bus.js';
export { systemClock } from './clock.js';
export type { Clock, TimerId } from './clock.js';
export {
  DEFAULT_DEDUPE,
  DEFAULT_OPTIONS,
  ERROR_MESSAGES,
  FATAL_ERRORS,
  RETRYABLE_ERRORS,
} from './types.js';
export type {
  DedupeOptions,
  DedupeReason,
  EngineEventMap,
  ErrorEvent,
  FinalEvent,
  InternalState,
  Metrics,
  PartialEvent,
  PublicState,
  RestartEvent,
  RestartReason,
  SpeechEngineOptions,
  StateEvent,
} from './types.js';

export const version = '0.1.0';
