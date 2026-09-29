import { getBrowserApi } from './chrome-types';
import { createBridge } from './bridge';

try {
  const api = getBrowserApi();
  const bridge = createBridge({ window, runtime: api.runtime });
  bridge.start();
  window.addEventListener('pagehide', () => bridge.stop());
} catch (error) {
  console.error('[speechpad-extension]', error);
}
