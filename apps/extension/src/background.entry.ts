import { getBrowserApi } from './chrome-types';
import { createBackground } from './background';

try {
  createBackground({ api: getBrowserApi() }).attach();
} catch (error) {
  console.error('[speechpad-extension]', error);
}
