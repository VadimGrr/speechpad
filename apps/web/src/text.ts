export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.length : 0;
}

export function countChars(text: string): number {
  return text.length;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatMs(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return `${value} мс`;
  return `${(value / 1000).toFixed(1)} с`;
}
