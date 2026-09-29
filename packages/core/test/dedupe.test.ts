import { describe, expect, it } from 'vitest';
import {
  dedupeFragment,
  isRecentRepeat,
  normalizeForCompare,
} from '../src/dedupe.js';

describe('normalizeForCompare', () => {
  it('lowercases, folds yo and strips punctuation', () => {
    expect(normalizeForCompare('  Привет, Мир!  ')).toBe('привет мир');
    expect(normalizeForCompare('Ёлка')).toBe('елка');
  });

  it('keeps digits and letters of any script', () => {
    expect(normalizeForCompare('Договор № 17 от 2024 г.')).toBe(
      'договор 17 от 2024 г',
    );
  });
});

describe('dedupeFragment', () => {
  it('keeps a genuinely new fragment', () => {
    const result = dedupeFragment('новая фраза', 'предыдущий текст подлиннее');
    expect(result.dropped).toBe(false);
    expect(result.text).toBe('новая фраза');
  });

  it('drops an exact tail repeat produced by restart', () => {
    const tail = 'мы обсуждали план проекта и сроки';
    const result = dedupeFragment('мы обсуждали план проекта и сроки', tail);
    expect(result.dropped).toBe(true);
    expect(result.reason).toBe('exact-tail');
  });

  it('drops a tail repeat that differs only in case and punctuation', () => {
    const tail = 'Мы обсуждали план, проекта и сроки.';
    const result = dedupeFragment('мы обсуждали план проекта и сроки', tail);
    expect(result.dropped).toBe(true);
    expect(result.reason).toBe('exact-tail');
  });

  it('strips the overlapping prefix and keeps the new remainder', () => {
    const tail = 'вчера мы обсуждали бюджет';
    const result = dedupeFragment('обсуждали бюджет на следующий квартал', tail);
    expect(result.dropped).toBe(false);
    expect(result.text).toBe('на следующий квартал');
  });

  it('drops a fragment already contained in the tail window', () => {
    const tail = 'начало разговора про отчёт и цифры, потом про бюджет и планы';
    const result = dedupeFragment('потом про бюджет', tail);
    expect(result.dropped).toBe(true);
    expect(result.reason).toBe('contained-in-tail');
  });

  it('keeps short repeated words instead of eating them', () => {
    const tail = 'скажи да';
    const result = dedupeFragment('да', tail);
    expect(result.dropped).toBe(false);
    expect(result.text).toBe('да');
  });

  it('treats an empty fragment as a drop', () => {
    const result = dedupeFragment('   ', 'любой текст');
    expect(result.dropped).toBe(true);
    expect(result.reason).toBe('empty');
  });

  it('only looks at the configured tail window', () => {
    const tail = `${'очень длинный текст '.repeat(40)}обсуждали бюджет`;
    expect(dedupeFragment('обсуждали бюджет', tail).dropped).toBe(true);
    const result = dedupeFragment('обсуждали бюджет', tail, {
      tailWindowChars: 10,
    });
    expect(result.dropped).toBe(false);
  });
});

describe('isRecentRepeat', () => {
  it('detects a repeated final among recent ones', () => {
    const recent = ['привет как дела', 'мы обсуждали план'];
    expect(isRecentRepeat('мы обсуждали план', recent, 5)).toBe(true);
    expect(isRecentRepeat('совсем другой текст', recent, 5)).toBe(false);
  });

  it('ignores fragments below the minimum length', () => {
    expect(isRecentRepeat('да', ['да'], 5)).toBe(false);
  });
});
