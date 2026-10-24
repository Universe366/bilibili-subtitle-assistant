// 窗口生命周期里两块需要注入依赖的逻辑（便于测试，不直接依赖 electron 单例）：
// - 关闭窗口：最小化到托盘 / 退出 / 取消，以及「记住我的选择」；
// - 渲染进程首帧：恢复会话 + 按需加载开发探针。

import { closeAction, closeChoiceFromDialog, shouldRestoreSession } from './windowPolicy';
import { restoreSession, type RestoreManager, type SavedSession } from './sessionRestore';

export interface CloseState {
  isQuitting: boolean;
  choicePending: boolean;
}

export interface CloseDialogOptions {
  type: 'question';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  checkboxLabel: string;
  checkboxChecked: boolean;
  noLink: boolean;
}

export interface CloseFlowDeps<S extends { general: { closeToTray?: boolean } }> {
  settings: S;
  hideWindow: () => void;
  quit: () => void;
  showMessageBox: (
    options: CloseDialogOptions
  ) => Promise<{ response: number; checkboxChecked?: boolean }>;
  loadSettings: () => S;
  saveSettings: (settings: S) => void;
  setChoicePending: (pending: boolean) => void;
  setQuitting: (value: boolean) => void;
  windowTitle: string;
}

/**
 * 返回 'allowed'：不拦截，窗口照常关闭；
 * 返回 'asked'：已 preventDefault，异步弹窗决定最小化/退出；弹窗失败时状态复位。
 */
export function handleCloseRequest<S extends { general: { closeToTray?: boolean } }>(
  event: { preventDefault: () => void },
  state: CloseState,
  deps: CloseFlowDeps<S>
): 'allowed' | 'asked' {
  const decision = closeAction({
    isQuitting: state.isQuitting,
    closeToTray: deps.settings.general.closeToTray,
    choicePending: state.choicePending
  });
  if (decision === 'allow') return 'allowed';

  event.preventDefault();
  deps.setChoicePending(true);
  void deps
    .showMessageBox({
      type: 'question',
      title: deps.windowTitle,
      message: '要最小化到托盘，还是退出应用？',
      detail: '最小化后可以从托盘图标恢复；选择「记住」下次不再询问。',
      buttons: ['最小化到托盘', '退出应用', '取消'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: '记住我的选择',
      checkboxChecked: false,
      noLink: true
    })
    .then((result) => {
      deps.setChoicePending(false);
      const choice = closeChoiceFromDialog(result);
      if (choice === 'cancel') return;
      if (result.checkboxChecked) {
        const settings = deps.loadSettings();
        settings.general.closeToTray = choice === 'tray';
        deps.saveSettings(settings);
      }
      if (choice === 'tray') {
        deps.hideWindow();
      } else {
        deps.setQuitting(true);
        deps.quit();
      }
    })
    .catch(() => {
      deps.setChoicePending(false);
    });
  return 'asked';
}

export interface BootstrapDeps {
  loadSettings: () => { general?: { restoreSession?: boolean } } | null | undefined;
  loadSession: () => SavedSession | null;
  manager: RestoreManager | null;
  startUrl: string;
  packaged: boolean;
  enableDevHooks: boolean;
  runDevHooks?: () => void | Promise<void>;
  log?: (...args: unknown[]) => void;
}

export interface BootstrapResult {
  restored: number;
  devHooks: boolean;
}

/** 页面首帧：恢复上次会话；开发探针只在未打包或显式开启时拉取。 */
export async function bootstrapRenderer(deps: BootstrapDeps): Promise<BootstrapResult> {
  const log = deps.log || ((...args: unknown[]) => console.log(...args));
  let restored = 0;

  if (deps.manager) {
    const saved = shouldRestoreSession(deps.loadSettings()) ? deps.loadSession() : null;
    const result = await restoreSession({
      manager: deps.manager,
      saved,
      startUrl: deps.startUrl
    });
    restored = result.restored;
    if (!result.usedStartUrl) log('[session] restored', result.restored, 'tabs');
  }

  const devHooks = !!deps.manager && !!deps.runDevHooks && (!deps.packaged || deps.enableDevHooks);
  if (devHooks) {
    try {
      await deps.runDevHooks?.();
    } catch (error) {
      log('[dev] hooks failed', (error as Error).message);
    }
  }
  return { restored, devHooks };
}
