import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/storage';

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('settings', () => {
  it('defaults to the native agent route', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings().insertRoute).toBe('agent');
  });

  it('keeps the tab route across reloads', () => {
    saveSettings({ ...DEFAULT_SETTINGS, insertRoute: 'tab' });
    expect(loadSettings().insertRoute).toBe('tab');
  });

  it('falls back to the agent for unknown or broken values', () => {
    globalThis.localStorage.setItem('speechpad.settings.v1', JSON.stringify({ insertRoute: 'smtp' }));
    expect(loadSettings().insertRoute).toBe('agent');
    globalThis.localStorage.setItem('speechpad.settings.v1', '{broken');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
