import { ipcMain } from 'electron';
import {
  beginRegionCapture,
  completeRegionCapture,
  shotOverlayPayload,
  type ShotSelection
} from '../shotOverlay';

/** 框选截图相关 IPC：桌宠发起、覆盖窗取图与回传结果。 */
export function registerShotIpc(): void {
  ipcMain.handle('shot:capture-region', async () => beginRegionCapture());
  ipcMain.handle('shot:init', () => shotOverlayPayload());
  ipcMain.handle('shot:done', (_event, payload: ShotSelection | null) => {
    completeRegionCapture(payload);
  });
}
