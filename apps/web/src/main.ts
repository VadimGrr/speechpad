import { SpeechpadEngine } from '@speechpad/core';
import type { Metrics, PublicState } from '@speechpad/core';
import './styles.css';
import { AgentClient, readInjectedHandshake } from './agent';
import { ExtensionClient } from './extension';
import { SyncBus, type StatePayload } from './channel';
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
import { renderAgentStatus } from './ui/agent-status';
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
const SNAPSHOT_DEBOUNCE_MS = 400;
const METRICS_THROTTLE_MS = 500;
const TOAST_MS = 6000;
const FLOAT_FEATURES = 'popup=yes,width=560,height=280';

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
  const compactButton = el<HTMLButtonElement>('compact');
  const insertButton = el<HTMLButtonElement>('insert');
  const insertRoute = el<HTMLSelectElement>('insert-route');
  const agentStatus = el<HTMLSpanElement>('agent-status');

  const bus = SyncBus.open();
  let compact: Window | null = null;

  let state: PublicState = 'idle';
  let sessionStart = 0;
  let saveTimer: number | null = null;
  let toastTimer: number | null = null;
  let lastMetricsAt = 0;
  let metricsTimer: number | null = null;
  let snapshotTimer: number | null = null;

  if (!bus) {
    compactButton.disabled = true;
    compactButton.title = 'Браузер не поддерживает BroadcastChannel';
  }

  const view = new TranscriptView(transcriptRoot, {
    onCommit: (text, source) => {
      updateStats(text);
      scheduleSave(text);
      syncUi();
      if (!bus) return;
      if (source === 'edit') scheduleSnapshot();
      if (source === 'clear') bus.send({ kind: 'reset' });
    },
  });
  view.setText(loadTranscript());
  updateStats(view.text);

  function statePayload(): StatePayload {
    return {
      state,
      supported: engine.isSupported,
      hasText: view.text.trim().length > 0,
      theme: settings.theme,
    };
  }

  function sendSnapshot(): void {
    bus?.send({ kind: 'snapshot', text: view.text, ...statePayload() });
  }

  function openCompact(): void {
    if (!bus) return;
    if (compact && !compact.closed) {
      compact.focus();
      return;
    }
    const url = new URL('float.html', window.location.href).href;
    compact = window.open(url, 'speechpad-float', FLOAT_FEATURES);
    if (!compact) showToast('Браузер заблокировал всплывающее окно');
  }

  compactButton.addEventListener('click', openCompact);

  bus?.onMessage((message) => {
    switch (message.kind) {
      case 'hello':
        sendSnapshot();
        break;
      case 'command':
        if (message.command === 'toggle') {
          engine.toggle();
          syncUi();
        } else if (message.command === 'clear') {
          clearAll();
        } else if (message.command === 'copy') {
          copyAll();
        } else if (message.command === 'focus-main') {
          window.focus();
        }
        break;
      case 'bye':
        compact = null;
        break;
      default:
        break;
    }
  });

  const env = inspectEnvironment(engine.isSupported, engine.unsupportedReason);
  const envMessage = environmentMessage(env);
  if (envMessage) {
    envText.textContent = envMessage;
    envBanner.hidden = false;
  }
  envDismiss.addEventListener('click', () => {
    envBanner.hidden = true;
  });

  const handshake = readInjectedHandshake();
  let agent: AgentClient | null = null;

  if (handshake) {
    agent = new AgentClient({ handshake });
    insertButton.disabled = false;
    insertButton.setAttribute('aria-pressed', String(settings.autoInsert));
    renderAgentStatus(agentStatus, 'connecting', handshake.insertScheme);
    agent.onStatus((status, detail) => {
      renderAgentStatus(agentStatus, status, handshake.insertScheme);
      if (status === 'error' && detail) showToast(detail);
    });
    agent.onError((message) => showToast(message));
    agent.onHotkey((action) => {
      if (action === 'toggle') {
        engine.toggle();
        syncUi();
        return;
      }
      if (action === 'clear') {
        clearAll();
        return;
      }
      showToast('Окно закреплено поверх остальных');
    });
    agent.connect();
  } else {
    insertButton.title = 'Автовставка работает через нативного агента';
  }

  insertButton.addEventListener('click', () => {
    settings.autoInsert = !settings.autoInsert;
    saveSettings(settings);
    insertButton.setAttribute('aria-pressed', String(settings.autoInsert));
  });

  insertRoute.value = settings.insertRoute;
  insertRoute.addEventListener('change', () => {
    settings.insertRoute = insertRoute.value === 'tab' ? 'tab' : 'agent';
    saveSettings(settings);
    showToast(
      settings.insertRoute === 'tab'
        ? 'Вставка идёт в поле активной вкладки браузера'
        : 'Вставка идёт в активное окно Windows',
    );
  });

  const extension = new ExtensionClient();
  let extensionReady = false;
  extension.start();
  void extension.probe().then((state) => {
    extensionReady = state.available && state.authorized;
    insertRoute.hidden = !state.available;
    if (state.available && !state.authorized) {
      insertRoute.value = 'agent';
      settings.insertRoute = 'agent';
    }
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

  function scheduleSnapshot(): void {
    if (!bus) return;
    if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(() => {
      snapshotTimer = null;
      sendSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
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

  engine.on('partial', (text) => {
    view.setInterim(text);
    bus?.send({ kind: 'interim', text });
  });
  engine.on('final', (text) => {
    view.appendFinal(text);
    scheduleSave(view.text);
    syncUi();
    bus?.send({ kind: 'final', text });
    bus?.send({ kind: 'state', ...statePayload() });
    if (settings.autoInsert) void insertFragment(text);
  });
  engine.on('state', (next) => {
    state = next;
    view.flush();
    syncUi();
    bus?.send({ kind: 'state', ...statePayload() });
  });
  engine.on('error', (info) => {
    showToast(info.message);
    syncUi();
  });
  engine.on('metrics', queueMetrics);

  async function insertFragment(text: string): Promise<void> {
    if (settings.insertRoute === 'tab' && extensionReady) {
      const outcome = await extension.insert(text);
      if (!outcome.ok) showToast(outcome.message ?? 'Расширение не вставило текст в поле вкладки');
      return;
    }
    if (!agent) {
      showToast('Автовставка недоступна: запустите нативного агента');
      return;
    }
    const outcome = await agent.insert(text);
    if (!outcome.ok) showToast('Агент не вставил текст в активное окно');
  }

  function clearAll(): void {
    view.clear();
    engine.clear();
    clearTranscript();
    updateStats('');
    syncUi();
  }

  async function copyAll(): Promise<void> {
    const text = view.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Скопировано в буфер обмена');
    } catch {
      showToast('Не удалось скопировать: браузер запретил доступ к буферу');
    }
  }

  controls.toggle.addEventListener('click', () => {
    engine.toggle();
    syncUi();
  });

  controls.clear.addEventListener('click', clearAll);
  controls.copy.addEventListener('click', () => void copyAll());

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
    bus?.send({ kind: 'state', ...statePayload() });
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

  window.addEventListener('pagehide', () => {
    saveTranscript(view.text);
    bus?.send({ kind: 'bye' });
    bus?.close();
    agent?.close();
    extension.stop();
  });

  window.setInterval(() => {
    if (state !== 'listening' || sessionStart === 0) return;
    timerEl.textContent = formatDuration(Date.now() - sessionStart);
  }, 1000);

  syncUi();
}

boot();
