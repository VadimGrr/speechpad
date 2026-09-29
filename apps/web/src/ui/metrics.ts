import type { Metrics } from '@speechpad/core';
import { formatMs } from '../text';

type Row = {
  label: string;
  value: string;
};

export function buildRows(metrics: Metrics): Row[] {
  return [
    { label: 'Состояние', value: metrics.state },
    { label: 'Фрагментов', value: String(metrics.finals) },
    { label: 'Перезапусков', value: String(metrics.restarts) },
    { label: 'Из них watchdog', value: String(metrics.watchdogRestarts) },
    { label: 'Пересозданий', value: String(metrics.recycles) },
    { label: 'Обрывов сессии', value: String(metrics.silentEnds) },
    { label: 'Повторов отброшено', value: String(metrics.duplicatesBlocked) },
    { label: 'Первый результат', value: formatMs(metrics.firstInterimAfterStartMs) },
    { label: 'Результат после рестарта', value: formatMs(metrics.lastInterimAfterRestartMs) },
    { label: 'Интервал интерма', value: formatMs(metrics.avgInterimIntervalMs) },
    { label: 'Максимум тишины', value: formatMs(metrics.maxSilenceGapMs) },
  ];
}

export function renderMetrics(root: HTMLElement, metrics: Metrics): void {
  const rows = buildRows(metrics);
  root.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('div');
      item.className = 'metric';
      const label = document.createElement('span');
      label.className = 'metric-label';
      label.textContent = row.label;
      const value = document.createElement('span');
      value.className = 'metric-value';
      value.textContent = row.value;
      item.append(label, value);
      return item;
    }),
  );
}
