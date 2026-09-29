import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const page = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const body = /<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? '';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

describe('main window bootstrap', () => {
  beforeAll(async () => {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.querySelectorAll('script').forEach((node) => node.remove());
    await import('../src/main');
  });

  it('warns that this browser cannot recognise speech', () => {
    const banner = byId('env-banner');
    expect(banner.hidden).toBe(false);
    expect(byId('env-text').textContent).toContain('Chrome');
  });

  it('starts in the idle state with empty transcript', () => {
    expect(byId('status').dataset['state']).toBe('idle');
    expect(byId('status').querySelector('.label')?.textContent).toBe('Готов');
    expect(byId('transcript').textContent).toBe('');
    expect(byId('stats').textContent).toBe('0 слов · 0 символов');
  });

  it('has no dead buttons', () => {
    expect(byId<HTMLButtonElement>('toggle').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('clear').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('copy').disabled).toBe(true);
    expect(byId<HTMLButtonElement>('metrics-toggle').disabled).toBe(false);
    expect(byId<HTMLButtonElement>('theme').disabled).toBe(false);
  });

  it('keeps the compact window button dead without BroadcastChannel', () => {
    const compact = byId<HTMLButtonElement>('compact');
    expect(compact.disabled).toBe(true);
    expect(compact.title).toContain('BroadcastChannel');
  });

  it('disables auto insert when the native agent is not present', () => {
    const insert = byId<HTMLButtonElement>('insert');
    expect(insert.disabled).toBe(true);
    expect(insert.title).toContain('агента');
    expect(byId('agent-status').dataset['status']).toBe('offline');
    expect(byId('agent-status').textContent).toBe('Агент не найден');
  });

  it('offers a list of recognition languages', () => {
    const select = byId<HTMLSelectElement>('lang');
    expect([...select.options].map((option) => option.value)).toEqual([
      'ru-RU',
      'uk-UA',
      'en-US',
      'de-DE',
      'fr-FR',
      'es-ES',
    ]);
    expect(select.value).toBe('ru-RU');
  });

  it('switches the theme and remembers the choice', () => {
    const button = byId<HTMLButtonElement>('theme');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    button.click();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(globalThis.localStorage.getItem('speechpad.settings.v1')).toContain('light');
    button.click();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('toggles the metrics panel', () => {
    const panel = byId('metrics');
    const button = byId<HTMLButtonElement>('metrics-toggle');
    expect(panel.hidden).toBe(true);
    button.click();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('.metric').length).toBeGreaterThan(0);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the transcript editable by hand', () => {
    const transcript = byId<HTMLDivElement>('transcript');
    transcript.textContent = 'текст введён вручную';
    transcript.dispatchEvent(new Event('input', { bubbles: true }));
    expect(byId('stats').textContent).toBe('3 слов · 20 символов');
    expect(byId<HTMLButtonElement>('clear').disabled).toBe(false);
  });
});
