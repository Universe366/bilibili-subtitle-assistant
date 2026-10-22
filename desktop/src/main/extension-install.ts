import { app, clipboard, dialog, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

interface BrowserTarget {
  name: string;
  exe: string;
  extensionsUrl: string;
}

function exists(file: string): boolean {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function browserTargets(): BrowserTarget[] {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] || '';
  const targets: BrowserTarget[] = [
    {
      name: 'Microsoft Edge',
      exe: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      extensionsUrl: 'edge://extensions'
    },
    {
      name: 'Microsoft Edge',
      exe: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      extensionsUrl: 'edge://extensions'
    },
    {
      name: 'Google Chrome',
      exe: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      extensionsUrl: 'chrome://extensions'
    },
    {
      name: 'Google Chrome',
      exe: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      extensionsUrl: 'chrome://extensions'
    }
  ];
  if (localAppData) {
    targets.push(
      {
        name: 'Microsoft Edge',
        exe: path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        extensionsUrl: 'edge://extensions'
      },
      {
        name: 'Google Chrome',
        exe: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        extensionsUrl: 'chrome://extensions'
      }
    );
  }
  return targets;
}

export function extensionSourceDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'extension');
  }
  // 开发期直接用仓库里的扩展源码，避免每次启动复制 30MB。
  const fromRepo = path.resolve(app.getAppPath(), '..', 'bilibili-subtitle-assistant');
  if (exists(path.join(fromRepo, 'manifest.json'))) return fromRepo;
  return path.join(app.getAppPath(), 'resources', 'extension');
}

export async function installBrowserExtension(
  win: BrowserWindow
): Promise<{ path: string; browser: string; opened: boolean }> {
  const source = extensionSourceDir();
  if (!exists(path.join(source, 'manifest.json'))) {
    throw new Error('没有找到扩展文件；请重新安装/更新桌面端后再试');
  }

  clipboard.writeText(source);
  const browser = browserTargets().find((item) => exists(item.exe)) || null;
  let opened = false;
  if (browser) {
    try {
      const child = spawn(browser.exe, [browser.extensionsUrl], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      opened = true;
    } catch {
      opened = false;
    }
  }

  const detail = [
    `扩展目录（已复制到剪贴板）：`,
    source,
    '',
    browser && opened
      ? `已尝试在 ${browser.name} 打开扩展管理页。`
      : '请手动打开浏览器的扩展管理页（Edge：edge://extensions；Chrome：chrome://extensions）。',
    '',
    '安装步骤：',
    '1. 打开右上角「开发者模式」；',
    '2. 点「加载解压缩的扩展」；',
    '3. 选择上面这个目录（可直接在地址栏粘贴剪贴板路径）。',
    '',
    '装好后打开任意 B 站视频：扩展会自动发现本机桌面端，不需要再填端口或 Token。'
  ].join('\n');

  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: '安装浏览器插件',
    message: '插件文件已准备好',
    detail,
    buttons: ['打开插件目录', '关闭'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0) {
    void shell.openPath(source);
  }

  return { path: source, browser: browser?.name || '', opened };
}
