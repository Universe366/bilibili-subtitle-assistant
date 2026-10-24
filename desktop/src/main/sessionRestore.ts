// 会话恢复：从 index.ts 的 did-finish-load 里抽出，便于回归测试。
//
// 行为必须与原来的内联实现一致：
// - 保存的标签逐个创建（activate:false），单个失败只记日志、继续；
// - 优先激活与 activeUrl 相同的标签，否则激活最后一个；
// - 一个都没恢复出来时退回起始页；
// - 没有保存的会话时也创建起始页。

export interface RestoreManager {
  create(url: string, options?: { activate?: boolean }): Promise<string>;
  activate(id: string): Promise<void>;
}

export interface SavedSession {
  tabs: Array<{ url: string }>;
  activeUrl?: string;
}

export interface RestoreResult {
  restored: number;
  usedStartUrl: boolean;
  activeUrl: string;
}

export interface RestoreDeps {
  manager: RestoreManager;
  saved: SavedSession | null;
  startUrl: string;
  warn?: (message: string, ...args: unknown[]) => void;
}

export async function restoreSession(deps: RestoreDeps): Promise<RestoreResult> {
  const { manager, saved, startUrl } = deps;
  const warn = deps.warn || ((message: string, ...args: unknown[]) => console.warn(message, ...args));

  if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) {
    await manager.create(startUrl);
    return { restored: 0, usedStartUrl: true, activeUrl: startUrl };
  }

  const created: Array<{ id: string; url: string }> = [];
  for (const item of saved.tabs) {
    try {
      const id = await manager.create(item.url, { activate: false });
      created.push({ id, url: item.url });
    } catch (error) {
      warn('[session] 恢复标签失败', item.url, (error as Error).message);
    }
  }

  const target = created.find((item) => item.url === saved.activeUrl) || created.at(-1);
  if (!target) {
    await manager.create(startUrl);
    return { restored: 0, usedStartUrl: true, activeUrl: startUrl };
  }
  await manager.activate(target.id);
  return { restored: created.length, usedStartUrl: false, activeUrl: target.url };
}
