export interface RecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

export interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternativeLike;
}

export interface RecognitionResultListLike {
  readonly length: number;
  [index: number]: RecognitionResultLike;
}

export interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: RecognitionResultListLike;
}

export interface RecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
}

export type RecognitionCtor = new () => RecognitionLike;

export interface RecognitionFactory {
  readonly available: boolean;
  readonly reason: string | null;
  create(): RecognitionLike;
}

export interface BrowserScope {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  isSecureContext?: boolean;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  location?: { protocol?: string };
}

function resolveCtor(scope: BrowserScope): RecognitionCtor | null {
  const candidate = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (typeof candidate !== 'function') return null;
  return candidate as RecognitionCtor;
}

export function isSecureContextLike(scope: BrowserScope): boolean {
  if (typeof scope.isSecureContext === 'boolean') return scope.isSecureContext;
  const protocol = scope.location?.protocol;
  if (typeof protocol !== 'string') return true;
  return protocol === 'https:' || protocol === 'localhost:' || protocol === 'file:';
}

export function createWebSpeechFactory(scope: BrowserScope): RecognitionFactory {
  const Ctor = resolveCtor(scope);
  if (!Ctor) {
    return {
      available: false,
      reason: 'not-supported',
      create() {
        throw new Error('ERROR:not-supported');
      },
    };
  }
  if (!isSecureContextLike(scope)) {
    return {
      available: false,
      reason: 'insecure-context',
      create() {
        throw new Error('ERROR:insecure-context');
      },
    };
  }
  return {
    available: true,
    reason: null,
    create: () => new Ctor(),
  };
}

export function defaultScope(): BrowserScope {
  return globalThis as unknown as BrowserScope;
}
