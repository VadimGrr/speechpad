import type { Clock, TimerId } from '../src/clock.js';
import type {
  RecognitionAlternativeLike,
  RecognitionErrorEventLike,
  RecognitionEventLike,
  RecognitionFactory,
  RecognitionLike,
  RecognitionResultListLike,
  RecognitionResultLike,
} from '../src/webSpeech.js';

type Task = { id: TimerId; fn: () => void; time: number; every: number | null };

export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly tasks = new Map<TimerId, Task>();

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerId {
    const id = this.nextId++;
    this.tasks.set(id, { id, fn, time: this.time + ms, every: null });
    return id;
  }

  clearTimeout(id: TimerId): void {
    this.tasks.delete(id);
  }

  setInterval(fn: () => void, ms: number): TimerId {
    const id = this.nextId++;
    this.tasks.set(id, { id, fn, time: this.time + ms, every: ms });
    return id;
  }

  clearInterval(id: TimerId): void {
    this.tasks.delete(id);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.tasks.values()]
        .filter((task) => task.time <= target)
        .sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!due) break;
      this.time = due.time;
      if (due.every === null) {
        this.tasks.delete(due.id);
      } else {
        due.time = this.time + due.every;
      }
      due.fn();
    }
    this.time = target;
  }
}

export type ResultPart = { text: string; final: boolean };

export class FakeRecognition implements RecognitionLike {
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;

  started = false;
  aborted = false;
  startCalls = 0;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: RecognitionEventLike) => void) | null = null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null = null;

  constructor(
    readonly index: number,
    private readonly onStartError: (index: number) => Error | null = () => null,
  ) {}

  start(): void {
    this.startCalls += 1;
    const error = this.onStartError(this.index);
    if (error) throw error;
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    this.started = false;
  }

  abort(): void {
    this.aborted = true;
    this.started = false;
  }

  emitResult(parts: ResultPart[], resultIndex = 0): void {
    const results: RecognitionResultLike[] = parts.map((part) => {
      const alternative: RecognitionAlternativeLike = {
        transcript: part.text,
        confidence: 0.9,
      };
      return { isFinal: part.final, length: 1, 0: alternative };
    });
    const list: Record<number, RecognitionResultLike> & { length: number } = {
      length: results.length,
    };
    results.forEach((result, i) => {
      list[i] = result;
    });
    this.onresult?.({
      resultIndex,
      results: list as unknown as RecognitionResultListLike,
    });
  }

  emitEnd(): void {
    this.onend?.();
  }

  emitError(code: string): void {
    this.onerror?.({ error: code });
  }
}

export class FakeFactory implements RecognitionFactory {
  readonly created: FakeRecognition[] = [];
  startErrorFor: (index: number) => Error | null = () => null;

  constructor(
    readonly available = true,
    readonly reason: string | null = null,
  ) {}

  create(): RecognitionLike {
    const index = this.created.length;
    const instance = new FakeRecognition(index, (i) => this.startErrorFor(i));
    this.created.push(instance);
    return instance;
  }

  get last(): FakeRecognition {
    const instance = this.created[this.created.length - 1];
    if (!instance) throw new Error('no recognizer created');
    return instance;
  }

  get count(): number {
    return this.created.length;
  }
}
