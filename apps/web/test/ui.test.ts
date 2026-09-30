import { describe, expect, it } from 'vitest';
import { AGENT_STATUS_LABELS, renderAgentStatus, SCHEME_LABELS } from '../src/ui/agent-status';
import { renderLicense } from '../src/ui/license';
import { buildRows, renderMetrics } from '../src/ui/metrics';
import { renderControls, renderStatus, TOGGLE_LABELS } from '../src/ui/status';
import { environmentMessage, inspectEnvironment } from '../src/env';
import { countChars, countWords, formatDuration, formatMs } from '../src/text';
import type { Metrics } from '@speechpad/core';

const metrics: Metrics = {
  restarts: 3,
  watchdogRestarts: 1,
  recycles: 0,
  silentEnds: 2,
  duplicatesBlocked: 4,
  finals: 42,
  lastResultAt: 10,
  lastRestartAt: 5,
  startedAt: 0,
  firstInterimAfterStartMs: 900,
  lastInterimAfterRestartMs: null,
  avgInterimIntervalMs: 1500,
  maxSilenceGapMs: 61000,
  state: 'listening',
};

function controls() {
  const make = () => document.createElement('button');
  return { toggle: make(), clear: make(), copy: make() };
}

describe('text helpers', () => {
  it('counts words and characters', () => {
    expect(countWords('раз два три')).toBe(3);
    expect(countWords('  ')).toBe(0);
    expect(countWords('двадцать пять и 100')).toBe(4);
    expect(countChars('абв')).toBe(3);
  });

  it('formats durations and latencies', () => {
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatMs(null)).toBe('—');
    expect(formatMs(800)).toBe('800 мс');
    expect(formatMs(1500)).toBe('1.5 с');
  });
});

describe('status and controls', () => {
  it('labels the status and marks the state for styling', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span class="label"></span>';
    renderStatus(root, 'listening');
    expect(root.dataset['state']).toBe('listening');
    expect(root.querySelector('.label')?.textContent).toBe('Слушаю');
  });

  it('switches the toggle label per state', () => {
    expect(TOGGLE_LABELS.idle).toBe('Слушать');
    expect(TOGGLE_LABELS.listening).toBe('Пауза');
    expect(TOGGLE_LABELS.paused).toBe('Продолжить');
    expect(TOGGLE_LABELS.error).toBe('Повторить');
  });

  it('disables dead buttons', () => {
    const ui = controls();
    renderControls(ui, { state: 'idle', hasText: false, supported: true });
    expect(ui.clear.disabled).toBe(true);
    expect(ui.copy.disabled).toBe(true);
    expect(ui.toggle.disabled).toBe(false);
    renderControls(ui, { state: 'paused', hasText: true, supported: true });
    expect(ui.clear.disabled).toBe(false);
    expect(ui.copy.disabled).toBe(false);
    expect(ui.toggle.textContent).toBe('Продолжить');
  });

  it('disables listening when the browser cannot recognise speech', () => {
    const ui = controls();
    renderControls(ui, { state: 'error', hasText: true, supported: false });
    expect(ui.toggle.disabled).toBe(true);
  });
});

describe('metrics panel', () => {
  it('renders every metric row', () => {
    const root = document.createElement('div');
    renderMetrics(root, metrics);
    const rows = [...root.querySelectorAll('.metric')];
    expect(rows).toHaveLength(buildRows(metrics).length);
    expect(root.textContent).toContain('Повторов отброшено');
    expect(root.textContent).toContain('61.0 с');
  });
});

describe('environment checks', () => {
  it('asks for Chrome when the API is missing', () => {
    const info = inspectEnvironment(false, 'not-supported', 'Mozilla/5.0 Firefox/130');
    expect(environmentMessage(info)).toContain('Chrome');
  });

  it('explains an insecure context', () => {
    const info = inspectEnvironment(false, 'insecure-context', 'Chrome/120');
    expect(environmentMessage(info)).toContain('127.0.0.1');
  });

  it('warns about Edge using Microsoft recognition', () => {
    const info = inspectEnvironment(
      true,
      null,
      'Mozilla/5.0 Chrome/120 Safari/537.36 Edg/120',
    );
    expect(environmentMessage(info)).toContain('Edge');
  });

  it('stays silent on a normal Chrome profile', () => {
    const info = inspectEnvironment(true, null, 'Mozilla/5.0 Chrome/120 Safari/537.36');
    expect(environmentMessage(info)).toBeNull();
  });
});

describe('agent status chip', () => {
  it('names every connection state', () => {
    expect(Object.keys(AGENT_STATUS_LABELS)).toEqual(['offline', 'connecting', 'online', 'error']);
    expect(AGENT_STATUS_LABELS['offline']).toBe('Агент не найден');
    expect(AGENT_STATUS_LABELS['error']).toBe('Агент недоступен');
  });

  it('marks the state as a data attribute', () => {
    const root = document.createElement('span');
    renderAgentStatus(root, 'connecting');
    expect(root.dataset['status']).toBe('connecting');
    expect(root.textContent).toBe('Подключение к агенту');
  });

  it('shows the insertion scheme once the agent is online', () => {
    const root = document.createElement('span');
    renderAgentStatus(root, 'online', 'unicode');
    expect(root.textContent).toBe('Агент в сети · юникод-ввод');
    expect(SCHEME_LABELS['clipboard']).toBe('буфер обмена');
  });
});

describe('license chip', () => {
  const info = {
    state: 'valid',
    message: 'действует до 2030-01-01',
    insertAllowed: true,
    extensionAllowed: true,
  };

  it('hides the chip when the license is valid', () => {
    const root = document.createElement('span');
    root.hidden = false;
    renderLicense(root, info);
    expect(root.hidden).toBe(true);
    expect(root.dataset['state']).toBe('valid');
  });

  it('explains that insertion is not paid for', () => {
    const root = document.createElement('span');
    renderLicense(root, { ...info, state: 'missing', message: 'лицензия не найдена', insertAllowed: false });
    expect(root.hidden).toBe(false);
    expect(root.textContent).toBe('Лицензия не найдена');
    expect(root.dataset['insertAllowed']).toBe('false');
    expect(root.title).toBe('лицензия не найдена');
  });

  it('shows the trial countdown', () => {
    const root = document.createElement('span');
    renderLicense(root, { ...info, state: 'trial', message: 'пробный период: осталось 2 дн. из 2' });
    expect(root.textContent).toBe('пробный период: осталось 2 дн. из 2');
  });

  it('names an expired license and keeps the reason in the title', () => {
    const root = document.createElement('span');
    renderLicense(root, { ...info, state: 'expired', message: 'срок лицензии истёк 2026-01-01' });
    expect(root.textContent).toBe('Срок лицензии истёк');
    expect(root.title).toBe('срок лицензии истёк 2026-01-01');
  });

  it('tolerates a missing element', () => {
    expect(() => renderLicense(null, info)).not.toThrow();
  });
});