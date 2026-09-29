import { describe, expect, it } from 'vitest';
import {
  describeTarget,
  isBridgeReply,
  isEditableElement,
  isLocalOrigin,
  isWebRequest,
  normalizeInsertText,
} from '../src/protocol';

describe('isWebRequest', () => {
  it('accepts ping and insert payloads', () => {
    expect(isWebRequest({ source: 'speechpad-web', kind: 'ping' })).toBe(true);
    expect(isWebRequest({ source: 'speechpad-web', kind: 'insert', text: 'да', seq: 3 })).toBe(true);
  });

  it('rejects foreign, malformed and oversized payloads', () => {
    expect(isWebRequest({ source: 'evil', kind: 'insert', text: 'x', seq: 1 })).toBe(false);
    expect(isWebRequest({ source: 'speechpad-web', kind: 'insert', text: 5, seq: 1 })).toBe(false);
    expect(isWebRequest({ source: 'speechpad-web', kind: 'insert', text: 'x', seq: 1.5 })).toBe(false);
    expect(isWebRequest(null)).toBe(false);
  });
});

describe('isBridgeReply', () => {
  it('validates both reply kinds', () => {
    expect(isBridgeReply({ source: 'speechpad-extension', kind: 'ready', authorized: true })).toBe(true);
    expect(isBridgeReply({ source: 'speechpad-extension', kind: 'inserted', ok: true, seq: 2 })).toBe(true);
    expect(isBridgeReply({ source: 'speechpad-extension', kind: 'inserted', ok: true })).toBe(false);
    expect(isBridgeReply({ source: 'speechpad-web', kind: 'ready', authorized: true })).toBe(false);
  });
});

describe('isLocalOrigin', () => {
  it('accepts loopback http(s) and rejects everything else', () => {
    expect(isLocalOrigin('http://127.0.0.1:8787')).toBe(true);
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin('https://localhost')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.2:8787')).toBe(false);
    expect(isLocalOrigin('https://speechpad.ru')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
    expect(isLocalOrigin('chrome-extension://abc')).toBe(false);
  });
});

describe('normalizeInsertText', () => {
  it('keeps the leading space, drops the trailing one, collapses gaps and caps length', () => {
    expect(normalizeInsertText(' привет \n\n\n\n мир ')).toBe(' привет\n\n мир');
    expect(normalizeInsertText('да\n')).toBe('да');
    expect(normalizeInsertText('a'.repeat(5000)).length).toBe(4000);
    expect(normalizeInsertText('   ')).toBe('');
  });
});

describe('isEditableElement', () => {
  it('accepts text inputs, textareas and editable hosts', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const role = document.createElement('div');
    role.setAttribute('role', 'textbox');
    expect([input, area, div, role].every((node) => isEditableElement(node))).toBe(true);
  });

  it('rejects buttons, checkboxes, disabled and readonly fields', () => {
    const button = document.createElement('button');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const disabled = document.createElement('input');
    disabled.disabled = true;
    const readonly = document.createElement('textarea');
    readonly.readOnly = true;
    const plain = document.createElement('div');
    const notEditable = document.createElement('div');
    notEditable.setAttribute('contenteditable', 'false');
    expect([button, checkbox, disabled, readonly, plain, notEditable].some(isEditableElement)).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });
});

describe('describeTarget', () => {
  it('mentions tag, id, name and hint', () => {
    const input = document.createElement('textarea');
    input.id = 'message';
    input.setAttribute('name', 'text');
    input.setAttribute('placeholder', 'Сообщение');
    expect(describeTarget(input)).toBe('textarea#message name=text Сообщение');
    expect(describeTarget(null)).toBe('');
  });
});
