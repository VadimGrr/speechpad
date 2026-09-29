import { getBrowserApi } from './chrome-types';
import { createInserter } from './inserter';
import type { InsertResult } from './protocol';

const globalScope = globalThis as { __speechpadInserter?: boolean };

try {
  const api = getBrowserApi();
  if (globalScope.__speechpadInserter) {
    throw new Error('inserter уже активен на этой странице');
  }
  globalScope.__speechpadInserter = true;
  const inserter = createInserter({ window, runtime: api.runtime });
  inserter.start();
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const record = message as { kind?: unknown; text?: unknown; seq?: unknown } | null;
    if (record?.kind !== 'insert' || typeof record.text !== 'string') {
      sendResponse(undefined);
      return false;
    }
    const result: InsertResult = inserter.insert(record.text);
    sendResponse({
      ok: result.ok,
      target: result.target,
      message: result.message,
      strategy: result.strategy,
      seq: typeof record.seq === 'number' ? record.seq : 0,
    });
    return false;
  });
} catch (error) {
  console.error('[speechpad-extension]', error);
}
