import type { AgentStatus, InsertScheme } from '../agent';

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  offline: 'Агент не найден',
  connecting: 'Подключение к агенту',
  online: 'Агент в сети',
  error: 'Агент недоступен',
};

export const SCHEME_LABELS: Record<InsertScheme, string> = {
  clipboard: 'буфер обмена',
  unicode: 'юникод-ввод',
};

export function renderAgentStatus(root: HTMLElement, status: AgentStatus, scheme?: InsertScheme): void {
  root.dataset['status'] = status;
  root.textContent =
    status === 'online' && scheme
      ? `${AGENT_STATUS_LABELS[status]} · ${SCHEME_LABELS[scheme]}`
      : AGENT_STATUS_LABELS[status];
}
