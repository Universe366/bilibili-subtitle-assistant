// 启动与窗口策略：从 index.ts 抽出的纯函数，便于在 Node 里回归测试。
//
// 这里只放「决定做什么」，不碰 BrowserWindow / Tray / dialog。
// 顺序与 index.ts 原有实现严格一致；改行为请先改这里的测试。

export interface KeyInputLike {
  type?: string;
  key: string;
  control?: boolean;
  shift?: boolean;
}

export type ShortcutAction =
  | 'exit-fullscreen'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-fullscreen'
  | 'quit';

/**
 * 按键 → 动作。返回 null 表示不拦截（交给页面/Chromium）。
 * Escape 只在全屏时生效，由调用方判断 isFullScreen()。
 */
export function shortcutAction(input: KeyInputLike): ShortcutAction | null {
  if (input.type !== 'keyDown') return null;
  const key = input.key;
  if (key === 'Escape' || key === 'Esc') return 'exit-fullscreen';
  if (input.control && (key === '=' || key === '+')) return 'zoom-in';
  if (input.control && (key === '-' || key === '_')) return 'zoom-out';
  if (input.control && key === '0') return 'zoom-reset';
  if (key === 'F11') return 'toggle-fullscreen';
  if (input.control && input.shift && key.toLowerCase() === 'q') return 'quit';
  return null;
}

export interface WindowFrame {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  backgroundColor: string;
  autoHideMenuBar: boolean;
  webPreferences: {
    preload: string;
    contextIsolation: boolean;
    sandbox: boolean;
    nodeIntegration: boolean;
  };
}

/** 主窗口的尺寸/安全设置；深色主题只影响首帧底色。 */
export function windowFrameOptions(input: { dark: boolean; preloadPath: string }): WindowFrame {
  return {
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: input.dark ? '#141416' : '#f6f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  };
}

/** Edge 风格的 UA；Chrome 版本取自 process.versions.chrome。 */
export function buildUserAgent(chromeVersion: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 Edg/${chromeVersion}`;
}

export function resolveStartUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.BSUB_START_URL || 'https://www.bilibili.com/';
}

/** 「恢复上次会话」开关；只有显式 false 才关闭。 */
export function shouldRestoreSession(
  settings: { general?: { restoreSession?: boolean } } | null | undefined
): boolean {
  return settings?.general?.restoreSession !== false;
}

export type CloseAction = 'allow' | 'ask';

/**
 * 关闭窗口时：'ask' 表示要 preventDefault 并弹「最小化/退出」对话框，
 * 'allow' 表示直接放行（退出中、设置里关掉了关闭到托盘、或对话框已在等待）。
 */
export function closeAction(input: {
  isQuitting: boolean;
  closeToTray?: boolean;
  choicePending: boolean;
}): CloseAction {
  if (input.isQuitting) return 'allow';
  if (input.closeToTray === false) return 'allow';
  if (input.choicePending) return 'allow';
  return 'ask';
}

export type CloseChoice = 'tray' | 'quit' | 'cancel';

/** 对话框按钮：0=最小化到托盘，1=退出，2/其他=取消。 */
export function closeChoiceFromDialog(result: { response: number }): CloseChoice {
  if (result.response === 0) return 'tray';
  if (result.response === 1) return 'quit';
  return 'cancel';
}
