import { SpeechpadEngine } from '@speechpad/core';
import type { Metrics, PublicState } from '@speechpad/core';
import './styles.css';
import { environmentMessage, inspectEnvironment } from './env';
import {
  clearTranscript,
  loadSettings,
  loadTranscript,
  saveSettings,
  saveTranscript,
  type Settings,
} from './storage';
import { countChars, countWords, formatDuration } from './text';
import { renderMetrics } from './ui/metrics';
import { renderControls, renderStatus, type Controls } from './ui/status';
import { TranscriptView } from './ui/transcript';

const LANGUAGES: { code: string; label: string }[] = [
  { code: 'ru-RU', label: 'Русский' },
  { code: 'uk-UA', label: 'Українська' },
  { code: 'en-US', label: 'English' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'es-ES', label: 'Español' },
];

const SAVE_DEBOUNCE_MS = 800;
const METRICS_THROTTLE_MS = 500;
const TOAST_MS = 6000;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function boot(): void {
  const settings: Settings = loadSettings();
  const engine = new SpeechpadEngine({ lang: settings.lang });

  const transcriptRoot = el<HTMLDivElement>('transcript');
  const statusRoot = el<HTMLDivElement>('status');
  const envBanner = el<HTMLDivElement>('env-banner');
  const envText = el<HTMLSpanElement>('env-text');
  const envDismiss = el<HTMLButtonElement>('env-dismiss');
  const toast = el<HTMLDivElement>('toast');
  const statsEl = el<HTMLSpanElement>('stats');
  const metricsEl = el<HTMLElement>('metrics');
  const langSelect = el<HTMLSelectElement>('lang');
  const themeButton = el<HTMLButtonElement>('theme');
  const metricsButton = el<HTMLButtonElement>('metrics-toggle');
  const timerEl = el<HTMLSpanElement>('session-timer');

  const controls: Controls = {
    toggle: el<HTMLButtonElement>('toggle'),
    clear: el<HTMLButtonElement>('clear'),
    copy: el<HTMLButtonElement>('copy'),
  };

  let state: PublicState = 'idle';
  let sessionStart = 0;
  let saveTimer: number | null = null;
  let toastTimer: number | null = null;
  let lastMetricsAt = 0;
  let metricsTimer: number | null = null;

  const view = new TranscriptView(transcriptRoot, {
    onCommit: (text) => {
      updateStats(text);
      scheduleSave(text);
      syncUi();
    },
  });
  view.setText(loadTranscript());
  updateStats(view.text);

  const env = inspectEnvironment(engine.isSupported, engine.unsupportedReason);
  const envMessage = environmentMessage(env);
  if (envMessage) {
    envText.textContent = envMessage;
    envBanner.hidden = false;
  }
  envDismiss.addEventListener('click', () => {
    envBanner.hidden = true;
  });

  function updateStats(text: string): void {
    statsEl.textContent = `${countWords(text)} слов · ${countChars(text)} символов`;
  }

  function scheduleSave(text: string): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      saveTranscript(text);
    }, SAVE_DEBOUNCE_MS);
  }

  function showToast(message: string): void {
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toast.hidden = true;
    }, TOAST_MS);
  }

  function syncUi(): void {
    renderStatus(statusRoot, state);
    renderControls(controls, {
      state,
      hasText: view.text.trim().length > 0,
      supported: engine.isSupported,
    });
    if (state === 'listening') {
      if (sessionStart === 0) sessionStart = Date.now();
    } else {
      sessionStart = 0;
      timerEl.textContent = '';
    }
  }

  function queueMetrics(metrics: Metrics): void {
    if (metricsEl.hidden) return;
    const now = Date.now();
    if (now - lastMetricsAt >= METRICS_THROTTLE_MS) {
      lastMetricsAt = now;
      renderMetrics(metricsEl, metrics);
      return;
    }
    if (metricsTimer !== null) return;
    metricsTimer = window.setTimeout(() => {
      metricsTimer = null;
      lastMetricsAt = Date.now();
      renderMetrics(metricsEl, engine.metrics);
    }, METRICS_THROTTLE_MS);
  }

  engine.on('partial', (text) => view.setInterim(text));
  engine.on('final', (text) => {
    view.appendFinal(text);
    scheduleSave(view.text);
    syncUi();
  });
  engine.on('state', (next) => {
    state = next;
    view.flush();
    syncUi();
  });
  engine.on('error', (info) => {
    showToast(info.message);
    syncUi();
  });
  engine.on('metrics', queueMetrics);

  controls.toggle.addEventListener('click', () => {
    engine.toggle();
    syncUi();
  });

  controls.clear.addEventListener('click', () => {
    view.clear();
    engine.clear();
    clearTranscript();
    updateStats('');
    syncUi();
  });

  controls.copy.addEventListener('click', async () => {
    const text = view.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Скопировано в буфер обмена');
    } catch {
      showToast('Не удалось скопировать: браузер запретил доступ к буферу');
    }
  });

  langSelect.replaceChildren(
    ...LANGUAGES.map((item) => {
      const option = document.createElement('option');
      option.value = item.code;
      option.textContent = item.label;
      return option;
    }),
  );
  langSelect.value = settings.lang;
  langSelect.addEventListener('change', () => {
    settings.lang = langSelect.value;
    saveSettings(settings);
    engine.setLang(settings.lang);
  });

  function applyTheme(theme: Settings['theme']): void {
    document.documentElement.dataset['theme'] = theme;
    themeButton.textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  }

  applyTheme(settings.theme);
  themeButton.addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings(settings);
    applyTheme(settings.theme);
  });

  metricsEl.hidden = !settings.showMetrics;
  metricsButton.setAttribute('aria-pressed', String(settings.showMetrics));
  if (settings.showMetrics) renderMetrics(metricsEl, engine.metrics);
  metricsButton.addEventListener('click', () => {
    settings.showMetrics = metricsEl.hidden;
    metricsEl.hidden = !settings.showMetrics;
    metricsButton.setAttribute('aria-pressed', String(settings.showMetrics));
    saveSettings(settings);
    if (settings.showMetrics) renderMetrics(metricsEl, engine.metrics);
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || !event.ctrlKey || !event.shiftKey) return;
    event.preventDefault();
    engine.toggle();
    syncUi();
  });

  window.addEventListener('beforeunload', () => {
    saveTranscript(view.text);
  });

  window.setInterval(() => {
    if (state !== 'listening' || sessionStart === 0) return;
    timerEl.textContent = formatDuration(Date.now() - sessionStart);
  }, 1000);

  syncUi();
}

boot();
