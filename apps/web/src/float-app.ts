import './styles.css';
import './float.css';
import { FloatWindow } from './float';
import { SyncBus } from './channel';

const win = new FloatWindow({
  document,
  bus: SyncBus.open(),
});

window.addEventListener('pagehide', () => win.dispose());
