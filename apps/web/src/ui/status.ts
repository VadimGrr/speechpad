import type { PublicState } from '@speechpad/core';

export const STATUS_LABELS: Record<PublicState, string> = {
  idle: 'Готов',
  listening: 'Слушаю',
  paused: 'Пауза',
  error: 'Ошибка',
};

export const TOGGLE_LABELS: Record<PublicState, string> = {
  idle: 'Слушать',
  listening: 'Пауза',
  paused: 'Продолжить',
  error: 'Повторить',
};

export interface Controls {
  toggle: HTMLButtonElement;
  clear: HTMLButtonElement;
  copy: HTMLButtonElement;
}

export interface ControlsView {
  state: PublicState;
  hasText: boolean;
  supported: boolean;
}

export function renderStatus(root: HTMLElement, state: PublicState): void {
  root.dataset['state'] = state;
  const label = root.querySelector('.label');
  if (label) label.textContent = STATUS_LABELS[state];
}

export function renderControls(controls: Controls, view: ControlsView): void {
  controls.toggle.textContent = TOGGLE_LABELS[view.state];
  controls.toggle.disabled = !view.supported;
  controls.clear.disabled = !view.hasText;
  controls.copy.disabled = !view.hasText;
}
