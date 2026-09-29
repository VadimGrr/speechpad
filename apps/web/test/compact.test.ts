import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const page = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const body = /<body>([\s\S]*)<\/body>/.exec(page)?.[1] ?? '';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const popup = { focus: vi.fn(), closed: false };

describe('compact window in the main window', () => {
  beforeAll(async () => {
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.querySelectorAll('script').forEach((node) => node.remove());
    await import('../src/main');
  });

  it('enables the compact window button', () => {
    const compact = byId<HTMLButtonElement>('compact');
    expect(compact.disabled).toBe(false);
    expect(compact.title).toBe('');
  });

  it('opens the compact window as a named popup', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    byId<HTMLButtonElement>('compact').click();
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/float\.html$/);
    expect(name).toBe('speechpad-float');
    expect(String(features)).toContain('popup=yes');
    open.mockRestore();
  });

  it('focuses the open popup instead of opening a second one', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    byId<HTMLButtonElement>('compact').click();
    expect(open).not.toHaveBeenCalled();
    expect(popup.focus).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it('explains a blocked popup instead of failing silently', () => {
    popup.closed = true;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    byId<HTMLButtonElement>('compact').click();
    expect(open).toHaveBeenCalled();
    expect(byId('toast').hidden).toBe(false);
    expect(byId('toast').textContent).toContain('всплывающее');
    open.mockRestore();
  });
});
