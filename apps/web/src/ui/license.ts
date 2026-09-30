import type { AgentLicense } from '../agent';

const STATE_LABELS: Record<string, string> = {
  valid: 'Лицензия активна',
  trial: 'Пробный период',
  missing: 'Лицензия не найдена',
  invalid: 'Лицензия отклонена',
  expired: 'Срок лицензии истёк',
};

export function licenseLabel(info: AgentLicense): string {
  const base = STATE_LABELS[info.state] ?? `Лицензия: ${info.state}`;
  if (info.state === 'valid') {
    return info.message ? `${base} · ${info.message}` : base;
  }
  if (info.state === 'trial') {
    return info.message || base;
  }
  return base;
}

export function renderLicense(root: HTMLElement | null, info: AgentLicense): void {
  if (!root) return;
  root.dataset['state'] = info.state;
  root.dataset['insertAllowed'] = String(info.insertAllowed);
  root.title = info.message;
  root.textContent = licenseLabel(info);
  root.hidden = info.state === 'valid';
}
