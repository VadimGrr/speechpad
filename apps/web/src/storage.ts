export type Theme = 'dark' | 'light';
export type InsertRoute = 'agent' | 'tab';

export interface Settings {
  lang: string;
  theme: Theme;
  showMetrics: boolean;
  autoInsert: boolean;
  insertRoute: InsertRoute;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ru-RU',
  theme: 'dark',
  showMetrics: false,
  autoInsert: true,
  insertRoute: 'agent',
};

const SETTINGS_KEY = 'speechpad.settings.v1';
const TRANSCRIPT_KEY = 'speechpad.transcript.v1';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    return;
  }
}

export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: typeof parsed.lang === 'string' ? parsed.lang : DEFAULT_SETTINGS.lang,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      showMetrics: parsed.showMetrics === true,
      autoInsert: parsed.autoInsert !== false,
      insertRoute: parsed.insertRoute === 'tab' ? 'tab' : 'agent',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTranscript(): string {
  return read(TRANSCRIPT_KEY) ?? '';
}

export function saveTranscript(text: string): void {
  write(TRANSCRIPT_KEY, text);
}

export function clearTranscript(): void {
  try {
    globalThis.localStorage?.removeItem(TRANSCRIPT_KEY);
  } catch {
    return;
  }
}
