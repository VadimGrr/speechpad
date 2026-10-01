import { describe, expect, it } from 'vitest';
import { InsertJoin } from '../src/ui/insert-join';

describe('insert join', () => {
  it('ends the fragment with a space so the caret is ready for the next phrase', () => {
    const join = new InsertJoin();
    expect(join.join('приём')).toBe('приём ');
  });

  it('never starts a payload with a space', () => {
    const join = new InsertJoin();
    for (const word of ['раз', 'два', 'три']) {
      expect(join.join(word).startsWith(' ')).toBe(false);
    }
  });

  it('keeps consecutive phrases apart in the target app', () => {
    const join = new InsertJoin();
    const out = ['Ну', 'неплохо', 'ну всё же'].map((p) => join.join(p));
    expect(out).toEqual(['Ну ', 'неплохо ', 'ну всё же ']);
    expect(out.join('')).toBe('Ну неплохо ну всё же ');
  });

  it('reproduces the reported dictation without glued words', () => {
    const join = new InsertJoin();
    const spoken = ['Ну', 'неплохо', 'ну всё же', 'склеивает'];
    const inserted = spoken.map((p) => join.join(p)).join('');
    expect(inserted).toBe('Ну неплохо ну всё же склеивает ');
  });

  it('collapses whitespace so a double space cannot appear', () => {
    const join = new InsertJoin();
    const out = [join.join('раз  два'), join.join(' три   четыре ')];
    expect(out.join('')).toBe('раз два три четыре ');
    expect(out.join('')).not.toMatch(/\s\s/);
  });

  it('keeps punctuation as spoken', () => {
    const join = new InsertJoin();
    expect(join.join('Охренеть!')).toBe('Охренеть! ');
    expect(join.join('да?')).toBe('да? ');
  });

  it('ignores fragments without words', () => {
    const join = new InsertJoin();
    expect(join.join('   ')).toBe('');
    expect(join.join('')).toBe('');
    expect(join.join('\n')).toBe('');
  });
});
