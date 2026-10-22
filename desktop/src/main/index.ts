import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { TabManager } from './tabs';
import { registerIpc } from './ipc';
import {
  closeLibrary,
  getSummaryFor,
  ingestVideo,
  initLibrary,
  listHistory,
  listLibrary,
  saveSummary,
  searchLibrary
} from './library';
import { fetchAudioRange, getAudioCandidates, getPageInfo, getSubtitles, getTrackBody } from './page';
import { summarize } from './ai';
import { searchWeb } from './search';
import { applyCorrectionToText } from './correction';
import { transcribe, transcribeFile } from './asr';
import { translateLines } from './translate';
import { optimizeLines } from './optimize';
import { batchSummarize } from './batch';
import { checkSubtitles } from './quality';
import { generateChapters } from './chapters';
import { callMcpTool, listMcpTools } from './mcp';
import { skillPrompt } from './skills';
import { chat } from './chat';
import { rankReferences } from './search';
import { batchUrls } from './urlbatch';
import { testPlatformConnection } from './platform';
import { backupData, restoreData } from './backup';
import { buildExport } from './exporters';
import { loadSettings, saveSettings, settingsSnapshot } from './settings';
import { startBridge, stopBridge } from './bridge';
import { disposeUpdater, initUpdater } from './updater';

const CHROME = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36 Edg/${CHROME}`;
const START_URL = process.env.BSUB_START_URL || 'https://www.bilibili.com/';

function writeLog(file: string, message: string): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, file), `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function fatal(tag: string, error: unknown): void {
  writeLog('fatal.log', `${tag}: ${(error as Error)?.stack || String(error)}`);
}

process.on('uncaughtException', (error) => fatal('uncaughtException', error));
process.on('unhandledRejection', (reason) => fatal('unhandledRejection', reason));
writeLog('startup.log', `boot packaged=${app.isPackaged}`);

// 开发期可用 BSUB_USER_DATA 指定会话目录（例如复用已登录的 Electron profile）
if (process.env.BSUB_USER_DATA) {
  try {
    fs.mkdirSync(process.env.BSUB_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.BSUB_USER_DATA);
  } catch (error) {
    console.warn('[app] 无法设置 userData:', (error as Error).message);
  }
}

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function resolveResource(name: string): string | null {
  const candidates = [
    path.join(process.resourcesPath, name),
    path.join(app.getAppPath(), 'resources', name)
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return file;
    } catch {
      // 尝试下一个
    }
  }
  return null;
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    if (mainWindow) void startBridge(mainWindow);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  const iconPath = resolveResource('tray.png');
  if (!iconPath) {
    console.warn('[tray] 找不到 tray.png，跳过托盘');
    return;
  }
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('B站字幕助手');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showWindow() },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ])
    );
    tray.on('double-click', () => showWindow());
    console.log('[tray] ready');
  } catch (error) {
    console.warn('[tray] 创建失败:', (error as Error).message);
  }
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'B站字幕助手',
    backgroundColor: dark ? '#141416' : '#f6f6f3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' || input.key === 'Esc') {
      if (!mainWindow?.isFullScreen()) return;
      event.preventDefault();
      void tabManager?.activeWebContents()?.executeJavaScript(
        'document.fullscreenElement ? document.exitFullscreen().catch(() => null) : null'
      ).catch(() => undefined);
      mainWindow.setFullScreen(false);
      return;
    }
    if (input.key === 'F11') {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    }
  });

  tabManager = new TabManager(
    mainWindow,
    (tabs) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tabs:changed', tabs);
      }
    },
    (result) => {
      if (!app.isPackaged) {
        console.log(
          '[find]',
          result.tabId.slice(0, 8),
          `${result.activeMatchOrdinal}/${result.matches}`,
          `final=${result.finalUpdate}`
        );
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('find:result', result);
      }
    }
  );
  registerIpc(mainWindow, tabManager);
  tabManager.setSuspendMinutes(loadSettings().general.suspendMinutes);

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[m0] userData', app.getPath('userData'));
    console.log('[m0] start', START_URL);
    void tabManager?.create(START_URL);

    if (process.env.BSUB_AUDIO_TEST === '1') {
      setTimeout(async () => {
        try {
          const wc = tabManager?.activeWebContents();
          if (!wc) return;
          const info = await getPageInfo(wc);
          const candidates = await getAudioCandidates(wc, info);
          console.log(
            '[audio-test] candidates',
            candidates.length,
            candidates[0].source,
            candidates[0].url.slice(0, 80)
          );
          const part = await fetchAudioRange(wc, candidates[0].url, 0, 1023);
          console.log('[audio-test] range', part.bytes.length, part.contentRange, part.contentType);
        } catch (error) {
          console.warn('[audio-test] failed', (error as Error).message);
        }
      }, 12000);
    }

    if (process.env.BSUB_MCP_CHAT_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_AI_TOOLS || 'http://127.0.0.1:8894/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          settings.mcp.enabled = true;
          settings.mcp.servers = [
            {
              id: 'mock',
              name: 'Mock MCP',
              url: process.env.BSUB_MOCK_MCP || 'http://127.0.0.1:8895/mcp',
              token: '',
              headers: {},
              enabled: true,
              transport: 'http' as 'http' | 'sse'
            }
          ];
          saveSettings(settings);
          const result = await chat({
            info: {
              kind: 'video',
              bvid: 'BV1',
              aid: 1,
              cid: 1,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title: '测试视频',
              owner: '测试UP',
              desc: '',
              duration: 10,
              url: '',
              signature: 'test'
            },
            lines: [{ start: 0, end: 2, text: '测试字幕' }],
            messages: [{ role: 'user', content: '调用工具' }]
          });
          console.log('[mcp-chat-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[mcp-chat-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_URLBATCH_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!tabManager) return;
          const url = process.env.BSUB_URLBATCH_URL || 'https://www.bilibili.com/video/BV1xrnz6gEVD';
          const result = await batchUrls(
            tabManager,
            [url],
            false,
            (index, total, currentUrl, title, stage, percent) =>
              console.log('[urlbatch-test]', index + 1, total, stage, Math.round(percent), title)
          );
          console.log('[urlbatch-test] done', JSON.stringify(result));
        } catch (error) {
          console.warn('[urlbatch-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_RANK_TEST === '1') {
      setTimeout(() => {
        const ranked = rankReferences('OpenAI GPT-5', [
          { title: '今日天气', url: 'https://a', snippet: '晴朗' },
          { title: 'OpenAI 发布 GPT-5', url: 'https://b', snippet: '新模型发布' },
          { title: 'GPT-5 评测', url: 'https://c', snippet: 'OpenAI 新模型实测' }
        ]);
        console.log('[rank-test]', JSON.stringify(ranked.map((item) => item.title)));
      }, 3000);
    }

    if (process.env.BSUB_MCP_SSE_TEST === '1') {
      setTimeout(async () => {
        try {
          const server = {
            id: 'mock-sse',
            name: 'Mock SSE',
            url: process.env.BSUB_MOCK_MCP_SSE || 'http://127.0.0.1:8893/sse',
            token: '',
            headers: {},
            enabled: true,
            transport: 'sse' as 'http' | 'sse'
          };
          const tools = await listMcpTools(server);
          const result = await callMcpTool(server, 'echo', { text: 'hello-sse' });
          console.log('[mcp-sse-test]', JSON.stringify({ tools: tools.map((tool) => tool.name), result }));
        } catch (error) {
          console.warn('[mcp-sse-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_MCP_TEST === '1') {
      setTimeout(async () => {
        try {
          const server = {
            id: 'mock',
            name: 'Mock MCP',
            url: process.env.BSUB_MOCK_MCP || 'http://127.0.0.1:8895/mcp',
            token: '',
            headers: {},
            enabled: true,
            transport: 'http' as 'http' | 'sse'
          };
          const tools = await listMcpTools(server);
          const result = await callMcpTool(server, 'echo', { text: 'hello' });
          const settings = loadSettings();
          const prompt = skillPrompt(settings);
          console.log(
            '[mcp-test]',
            JSON.stringify({
              tools: tools.map((tool) => tool.name),
              result,
              skillsInjected: prompt.includes('深度总结'),
              promptLength: prompt.length
            })
          );
        } catch (error) {
          console.warn('[mcp-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_QUALITY_TEST === '1') {
      setTimeout(async () => {
        try {
          const info = {
            kind: 'video',
            bvid: 'BV1QA',
            aid: 1,
            cid: 1,
            epId: null,
            seasonId: null,
            page: 1,
            partTitle: '',
            parts: [],
            title: '质检测试',
            owner: '测试UP',
            desc: '',
            duration: 100,
            url: '',
            signature: 'qa'
          };
          const report = checkSubtitles(info, [
            { start: 0, end: 2, text: '第一句' },
            { start: 1, end: 3, text: '第一句' },
            { start: 50, end: 40, text: '坏时间' }
          ]);
          console.log(
            '[quality-test]',
            JSON.stringify({ stats: report.stats, codes: report.issues.map((item) => item.code) })
          );

          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_CHAPTERS || 'http://127.0.0.1:8896/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);
          const chapters = await generateChapters(info, [
            { start: 0, end: 3, text: '开场内容' },
            { start: 3, end: 6, text: '测试内容' }
          ]);
          console.log('[chapters-test]', JSON.stringify(chapters));
        } catch (error) {
          console.warn('[quality-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_BATCH_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_AI || 'http://127.0.0.1:8787/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);
          ingestVideo({
            info: {
              kind: 'video',
              bvid: 'BV1BATCH',
              aid: 1,
              cid: 1,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title: '批量测试视频',
              owner: '测试UP',
              desc: '',
              duration: 10,
              url: 'https://www.bilibili.com/video/BV1BATCH',
              signature: 'batch'
            },
            track: {
              lan: 'zh',
              lanDoc: '中文',
              url: 'asr://batch',
              isAi: false,
              aiStatus: null,
              source: 'asr'
            },
            lines: [
              { start: 0, end: 2, text: '第一句测试字幕' },
              { start: 2, end: 4, text: '第二句测试字幕' }
            ]
          });
          const list = listLibrary();
          const id = list.videos[0]?.id;
          if (!id) throw new Error('库内没有视频');
          const result = await batchSummarize([id], (percent, message) =>
            console.log('[batch-test]', Math.round(percent), message)
          );
          const history = listHistory();
          console.log(
            '[batch-test] done',
            JSON.stringify({
              succeeded: result.succeeded,
              failed: result.failed.length,
              history: history.length,
              first: history[0]?.title
            })
          );
        } catch (error) {
          console.warn('[batch-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_EXPORT_TEST === '1') {
      setTimeout(() => {
        try {
          const info = {
            kind: 'video',
            bvid: 'BV1TEST',
            aid: 1,
            cid: 1,
            epId: null,
            seasonId: null,
            page: 1,
            partTitle: '',
            parts: [],
            title: '测试视频',
            owner: '测试UP',
            desc: '',
            duration: 10,
            url: 'https://www.bilibili.com/video/BV1TEST',
            signature: 'test'
          };
          const lines = [
            { start: 0, end: 2, text: '第一句字幕' },
            { start: 2, end: 4, text: '第二句字幕' }
          ];
          const translatedLines = [
            { start: 0, end: 2, text: 'First subtitle' },
            { start: 2, end: 4, text: 'Second subtitle' }
          ];
          const vtt = buildExport({
            format: 'vtt',
            info,
            track: null,
            lines,
            translatedLines,
            translationLanguage: 'English'
          });
          const ass = buildExport({
            format: 'ass',
            info,
            track: null,
            lines,
            assFontSize: 32
          });
          const notes = buildExport({
            format: 'md',
            info,
            track: null,
            lines,
            summary: '测试总结',
            template: 'notes'
          });
          console.log('[export-test] vtt', vtt.content.split(/\n/).slice(0, 6).join(' | '));
          console.log(
            '[export-test] assStyle',
            ass.content.split(/\n/).find((line) => line.startsWith('Style:'))
          );
          console.log(
            '[export-test] assDialogue',
            ass.content.split(/\n/).find((line) => line.startsWith('Dialogue:'))
          );
          console.log('[export-test] notes', notes.content.slice(0, 120).replace(/\n/g, ' | '));
        } catch (error) {
          console.warn('[export-test] failed', (error as Error).message);
        }
      }, 3000);
    }

    if (process.env.BSUB_OPTIMIZE_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_OPTIMIZE || 'http://127.0.0.1:8897/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);
          const suggestions = await optimizeLines(
            [
              { start: 0, end: 1, text: '这是错别字' },
              { start: 1, end: 2, text: '第二句' }
            ],
            (percent, message) => console.log('[optimize-test]', Math.round(percent), message),
            undefined,
            settings
          );
          console.log('[optimize-test] done', JSON.stringify(suggestions));
        } catch (error) {
          console.warn('[optimize-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_TRANSLATE_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_TRANSLATE || 'http://127.0.0.1:8898/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);
          const result = await translateLines(
            [
              { start: 0, end: 1, text: '你好世界' },
              { start: 1, end: 2, text: '这是第二句' }
            ],
            'English',
            (percent, message) => console.log('[translate-test]', Math.round(percent), message),
            undefined,
            settings
          );
          console.log('[translate-test] done', JSON.stringify(result.lines));
        } catch (error) {
          console.warn('[translate-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_ASR_TEST === '1') {
      setTimeout(async () => {
        try {
          const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'asr-test-'));
          const input = path.join(dir, 'test.wav');
          const rate = 16000;
          const samples = rate * 5;
          const pcm = Buffer.alloc(samples * 2);
          for (let index = 0; index < samples; index += 1) {
            const value = Math.sin((2 * Math.PI * 440 * index) / rate) * 0.2;
            pcm.writeInt16LE(Math.round(value * 32767), index * 2);
          }
          const header = Buffer.alloc(44);
          header.write('RIFF', 0);
          header.writeUInt32LE(36 + pcm.length, 4);
          header.write('WAVE', 8);
          header.write('fmt ', 12);
          header.writeUInt32LE(16, 16);
          header.writeUInt16LE(1, 20);
          header.writeUInt16LE(1, 22);
          header.writeUInt32LE(rate, 24);
          header.writeUInt32LE(rate * 2, 28);
          header.writeUInt16LE(2, 32);
          header.writeUInt16LE(16, 34);
          header.write('data', 36);
          header.writeUInt32LE(pcm.length, 40);
          fs.writeFileSync(input, Buffer.concat([header, pcm]));

          const settings = loadSettings();
          settings.asr.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_ASR || 'http://127.0.0.1:8899/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.asr.activeId = 'mock';
          settings.asr.chunkSeconds = 2;
          settings.asr.audioFormat = process.env.BSUB_ASR_FORMAT === 'm4a' ? 'm4a' : 'wav';
          settings.asr.concurrency = 1;
          saveSettings(settings);

          const result = await transcribeFile(
            input,
            {
              kind: 'video',
              bvid: 'BV1',
              aid: 1,
              cid: 1,
              epId: null,
              seasonId: null,
              page: 1,
              partTitle: '',
              parts: [],
              title: '测试视频',
              owner: '测试UP',
              desc: '',
              duration: 5,
              url: '',
              signature: 'test'
            },
            (stage, percent, message) =>
              console.log('[asr-test]', stage, Math.round(percent), message),
            undefined,
            settings
          );
          console.log('[asr-test] done', result.lines.length, JSON.stringify(result.lines.slice(0, 4)));
          writeLog('asr-test.log', `done lines=${result.lines.length}`);
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          console.warn('[asr-test] failed', (error as Error).message);
          writeLog('asr-test.log', `failed: ${(error as Error).message}`);
        }
      }, 5000);
    }

    if (process.env.BSUB_CHAT_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!mainWindow) return;
          const settings = loadSettings();
          settings.ai.platforms = [
            {
              id: 'mock',
              name: 'Mock',
              baseUrl: process.env.BSUB_MOCK_AI || 'http://127.0.0.1:8787/v1',
              apiKey: 'mock',
              model: 'mock'
            }
          ];
          settings.ai.activeId = 'mock';
          saveSettings(settings);

          const result = await mainWindow.webContents.executeJavaScript(`new Promise(async (resolve) => {
            const info = { title: '测试视频', owner: '测试UP', duration: 60, bvid: 'BV1', cid: 1, url: '' };
            const lines = [
              { start: 0, end: 5, text: '这是第一句字幕。' },
              { start: 5, end: 10, text: '这是第二句字幕。' }
            ];
            let text = '';
            const offD = window.bsub.onChatDelta((e) => { text += e.delta; });
            const offDone = window.bsub.onChatDone((e) => {
              offD(); offDone(); offErr();
              resolve({ ok: true, len: e.text.length, text: e.text.slice(0, 40) });
            });
            const offErr = window.bsub.onChatError((e) => {
              offD(); offDone(); offErr();
              resolve({ ok: false, error: e.error });
            });
            const started = await window.bsub.chat({
              requestId: 'chat-test',
              info,
              lines,
              messages: [{ role: 'user', content: '这个视频讲了什么？' }]
            });
            if (!started.ok) {
              offD(); offDone(); offErr();
              resolve({ ok: false, error: started.error });
            }
          })`);
          console.log('[chat-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[chat-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_CORRECTION_TEST === '1') {
      setTimeout(() => {
        const settings = loadSettings();
        settings.correction.groups = [
          {
            id: 'g',
            name: '测试',
            enabled: true,
            rules: [
              {
                id: 'r1',
                pattern: 'AI',
                replacement: '人工智能',
                regex: false,
                caseSensitive: true
              }
            ]
          }
        ];
        settings.correction.glossary.terms = [
          { id: 't', from: 'UP主', to: 'UP 主', note: '' }
        ];
        console.log(
          '[correction-test]',
          applyCorrectionToText('AI 和 UP主 的视频，AI 很好', settings)
        );
      }, 4000);
    }

    if (process.env.BSUB_LIVE_URLBATCH_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!tabManager) throw new Error('标签管理器未就绪');
          const raw = String(process.env.BSUB_LIVE_URLBATCH_URLS || '').trim();
          const urls = raw
            ? raw.split(',').map((item) => item.trim()).filter(Boolean)
            : [
                'https://www.bilibili.com/video/BV1GJ411x7h7',
                'https://www.bilibili.com/video/BV1xrnz6gEVD'
              ];
          const result = await batchUrls(
            tabManager,
            urls,
            false,
            (index, total, url, title, stage, percent) =>
              console.log('[live-urlbatch]', index + 1, total, stage, Math.round(percent), title),
          );
          const library = listLibrary().videos;
          console.log(
            '[live-urlbatch] done',
            JSON.stringify({
              urls: urls.length,
              result,
              library: library.map((item) => ({ title: item.title, lines: item.lineCount }))
            })
          );
        } catch (error) {
          console.warn('[live-urlbatch] failed', (error as Error).message);
        }
      }, 8000);
    }

    if (process.env.BSUB_LIVE_MCP_TEST === '1') {
      setTimeout(async () => {
        try {
          const server = {
            id: 'exa-live',
            name: 'Exa MCP',
            url: process.env.BSUB_LIVE_MCP_URL || 'https://mcp.exa.ai/mcp',
            token: '',
            headers: {},
            enabled: true,
            transport: 'http' as const
          };
          const tools = await listMcpTools(server);
          console.log('[live-mcp] tools', tools.map((tool) => tool.name));
          const result = await callMcpTool(
            server,
            'web_search_exa',
            { query: 'OpenAI GPT-5', numResults: 2 },
            45000
          );
          console.log('[live-mcp] result', result.slice(0, 500));
        } catch (error) {
          console.warn('[live-mcp] failed', (error as Error).message);
        }
      }, 6000);
    }

    if (process.env.BSUB_LIVE_URLBATCH_404_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!tabManager) throw new Error('标签管理器未就绪');
          const started = Date.now();
          const result = await batchUrls(
            tabManager,
            ['https://www.bilibili.com/video/BV0000000000'],
            false,
            (index, total, url, title, stage, percent) =>
              console.log('[live-urlbatch-404]', index + 1, total, stage, Math.round(percent), title),
          );
          console.log(
            '[live-urlbatch-404] done',
            JSON.stringify({
              seconds: Math.round((Date.now() - started) / 1000),
              result,
              tabs: tabManager.list().length
            })
          );
        } catch (error) {
          console.warn('[live-urlbatch-404] failed', (error as Error).message);
        }
      }, 7000);
    }

    if (process.env.BSUB_LIVE_URLBATCH_FAIL_TEST === '1') {
      setTimeout(async () => {
        try {
          if (!tabManager) throw new Error('标签管理器未就绪');
          const valid = 'https://www.bilibili.com/video/BV1GJ411x7h7';
          const urls = [valid, 'https://example.com/not-a-video', valid];
          const result = await batchUrls(
            tabManager,
            urls,
            false,
            (index, total, url, title, stage, percent) =>
              console.log('[live-urlbatch-fail]', index + 1, total, stage, Math.round(percent), title),
          );
          const library = listLibrary().videos;
          console.log(
            '[live-urlbatch-fail] done',
            JSON.stringify({
              result,
              libraryCount: library.length,
              items: library.map((item) => ({ title: item.title, lines: item.lineCount }))
            })
          );
        } catch (error) {
          console.warn('[live-urlbatch-fail] failed', (error as Error).message);
        }
      }, 7000);
    }

    if (process.env.BSUB_LIVE_AI_TEST === '1') {
      setTimeout(async () => {
        try {
          const wc = tabManager?.activeWebContents();
          if (!wc) throw new Error('没有活动标签');
          const info = await getPageInfo(wc);
          const bundle = await getSubtitles(wc);
          console.log('[live-ai] info', info.title, 'tracks', bundle.tracks.length, 'needLogin', bundle.needLogin);
          if (!bundle.tracks.length) throw new Error('没有字幕轨');
          let track = bundle.tracks[0];
          let lines: any[] = [];
          for (const candidate of bundle.tracks.slice(0, 6)) {
            try {
              const body = await getTrackBody(candidate.url);
              if (body.lines.length > lines.length) {
                track = candidate;
                lines = body.lines;
              }
            } catch {
              // 单轨失败不影响其他候选
            }
          }
          if (!lines.length) throw new Error('字幕正文为空');
          console.log('[live-ai] lines', lines.length, 'track', track.lanDoc || track.lan);

          const summary = await summarize({
            info,
            lines,
            signal: undefined,
            onStatus: (status) => console.log('[live-ai] status', status)
          });
          console.log('[live-ai] summary', summary.model, summary.text.length, JSON.stringify(summary.text.slice(0, 220)));

          const answer = await chat({
            info,
            lines,
            messages: [{ role: 'user', content: '用三句话概括这个视频。' }]
          });
          console.log('[live-ai] chat', answer.model, answer.text.length, JSON.stringify(answer.text.slice(0, 180)));

          const translated = await translateLines(
            lines.slice(0, 20),
            'English',
            (percent, message) => console.log('[live-ai] translate', Math.round(percent), message),
            undefined,
            loadSettings()
          );
          console.log('[live-ai] translate', translated.lines.length, JSON.stringify(translated.lines[0]?.text?.slice(0, 120)));

          const suggestions = await optimizeLines(lines.slice(0, 30), () => undefined, undefined, loadSettings());
          console.log('[live-ai] optimize', suggestions.length, JSON.stringify(suggestions.slice(0, 2)));

          const chapters = await generateChapters(info, lines);
          console.log('[live-ai] chapters', chapters.length, JSON.stringify(chapters.slice(0, 2)));
          console.log('[live-ai] done');
        } catch (error) {
          console.warn('[live-ai] failed', (error as Error).message);
        }
      }, 9000);
    }

    if (process.env.BSUB_LIVE_ASR_TEST === '1') {
      setTimeout(async () => {
        try {
          const wc = tabManager?.activeWebContents();
          if (!wc) throw new Error('没有活动标签');
          const info = await getPageInfo(wc);
          console.log('[live-asr] info', info.title, 'duration', info.duration);
          const started = Date.now();
          const result = await transcribe(wc, info, (stage, percent, message) =>
            console.log('[live-asr]', stage, Math.round(percent), message)
          );
          console.log(
            '[live-asr] done',
            result.model,
            result.lines.length,
            Math.round((Date.now() - started) / 1000) + 's',
            JSON.stringify(result.lines.slice(0, 3))
          );
        } catch (error) {
          console.warn('[live-asr] failed', (error as Error).message);
        }
      }, 9000);
    }

    if (process.env.BSUB_RESTORE_TEST === '1') {
      setTimeout(async () => {
        try {
          const result = await restoreData();
          console.log('[restore-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[restore-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_BACKUP_TEST === '1') {
      setTimeout(async () => {
        try {
          const result = await backupData();
          console.log('[backup-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[backup-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_RESIZE_TEST === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const dom = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              const resizer = document.querySelector('.sidebar-resizer');
              if (!resizer) return { error: 'no resizer' };
              const rect = resizer.getBoundingClientRect();
              resizer.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, clientX: rect.left + 2, clientY: rect.top + 30
              }));
              await wait(450);
              const snapshotDuring = Boolean(document.querySelector('.stage-snapshot'));
              window.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, clientX: rect.left + 112, clientY: rect.top + 30
              }));
              await wait(120);
              window.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, clientX: rect.left + 112, clientY: rect.top + 30
              }));
              await wait(700);
              const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
              const stage = document.querySelector('.browser-stage')?.getBoundingClientRect();
              return {
                sidebar: sidebar ? Math.round(sidebar.width) : 0,
                stage: stage ? { x: Math.round(stage.left), w: Math.round(stage.width) } : null,
                snapshotDuring,
                snapshotAfter: Boolean(document.querySelector('.stage-snapshot'))
              };
            })()
          `);
          console.log(
            '[resize-test]',
            JSON.stringify({ dom, view: tabManager?.getActiveViewState() })
          );
        } catch (error) {
          console.warn('[resize-test] failed', (error as Error).message);
        }
      }, 5500);
    }

    if (process.env.BSUB_DOCK_ONLY_TEST === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const dom = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              const brand = document.querySelector('.brand');
              if (!brand) return { error: 'no brand' };
              const rect = brand.getBoundingClientRect();
              brand.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, clientX: 80, clientY: rect.top + 12
              }));
              await wait(450);
              window.dispatchEvent(new MouseEvent('mousemove', {
                bubbles: true, clientX: window.innerWidth - 50, clientY: rect.top + 12
              }));
              window.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, clientX: window.innerWidth - 50, clientY: rect.top + 12
              }));
              await wait(900);
              const stage = document.querySelector('.browser-stage')?.getBoundingClientRect();
              return {
                body: document.querySelector('.app-body')?.className,
                stage: stage ? { x: Math.round(stage.left), w: Math.round(stage.width) } : null
              };
            })()
          `);
          await new Promise((resolve) => setTimeout(resolve, 900));
          console.log(
            '[dock-only]',
            JSON.stringify({ dom, view: tabManager?.getActiveViewState() })
          );
        } catch (error) {
          console.warn('[dock-only] failed', (error as Error).message);
        }
      }, 5500);
    }

    if (process.env.BSUB_DOCK_TEST === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const result = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              const drag = async (element, startX, endX) => {
                const rect = element.getBoundingClientRect();
                element.dispatchEvent(new MouseEvent('mousedown', {
                  bubbles: true, clientX: startX, clientY: rect.top + 12
                }));
                await wait(450);
                const snapshot = Boolean(document.querySelector('.drag-snapshot'));
                window.dispatchEvent(new MouseEvent('mousemove', {
                  bubbles: true, clientX: endX, clientY: rect.top + 12
                }));
                await wait(80);
                window.dispatchEvent(new MouseEvent('mouseup', {
                  bubbles: true, clientX: endX, clientY: rect.top + 12
                }));
                await wait(700);
                return { snapshot, snapshotAfter: Boolean(document.querySelector('.drag-snapshot')) };
              };
              const collapseIcon = () =>
                document.querySelector('.sidebar-collapse svg')?.getAttribute('class') || '';
              const brand = document.querySelector('.brand');
              if (!brand) return { error: 'no brand' };
              const before = {
                body: document.querySelector('.app-body')?.className,
                title: document.querySelector('.sidebar-collapse')?.getAttribute('title'),
                icon: collapseIcon()
              };
              const dockDrag = await drag(brand, 80, window.innerWidth - 50);
              const afterDock = {
                body: document.querySelector('.app-body')?.className,
                width: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().width || 0),
                title: document.querySelector('.sidebar-collapse')?.getAttribute('title'),
                icon: collapseIcon(),
                ...dockDrag
              };
              const resizer = document.querySelector('.sidebar-resizer');
              const collapseDrag = resizer ? await drag(resizer, 900, 1180) : {};
              const afterCollapse = {
                body: document.querySelector('.app-body')?.className,
                width: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().width || 0),
                title: document.querySelector('.sidebar-collapse')?.getAttribute('title'),
                icon: collapseIcon(),
                ...collapseDrag
              };
              return { before, afterDock, afterCollapse };
            })()
          `);
          console.log('[dock-test]', JSON.stringify(result));
          console.log('[dock-test-view]', JSON.stringify(tabManager?.getActiveViewState()));
        } catch (error) {
          console.warn('[dock-test] failed', (error as Error).message);
        }
      }, 5500);
    }

    if (process.env.BSUB_FULLSCREEN_TEST === '1') {
      setTimeout(async () => {
        try {
          const win = mainWindow;
          if (!win) return;
          win.setFullScreen(true);
          await new Promise((resolve) => setTimeout(resolve, 500));
          const wc = tabManager?.activeWebContents();
          wc?.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          await new Promise((resolve) => setTimeout(resolve, 700));
          const afterView = win.isFullScreen();
          if (afterView) win.setFullScreen(false);
          win.setFullScreen(true);
          await new Promise((resolve) => setTimeout(resolve, 400));
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          await new Promise((resolve) => setTimeout(resolve, 600));
          console.log('[fullscreen-test]', JSON.stringify({
            afterViewEscape: afterView,
            afterWindowEscape: win.isFullScreen()
          }));
          win.setFullScreen(false);
        } catch (error) {
          console.warn('[fullscreen-test] failed', (error as Error).message);
        }
      }, 6500);
    }

    if (process.env.BSUB_SAVE_AUDIT === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const result = await win.webContents.executeJavaScript(`
            (async () => {
              const nav = [...document.querySelectorAll('button')].find((item) =>
                (item.textContent || '').trim() === '设置'
              );
              nav?.click();
              await new Promise((resolve) => setTimeout(resolve, 500));
              const sticky = document.querySelector('.settings-sticky');
              const bar = document.querySelector('.settings-sticky .panel-toolbar');
              const actions = document.querySelector('.settings-sticky .toolbar-actions');
              const button = [...document.querySelectorAll('.settings-sticky button')].find((item) =>
                (item.textContent || '').includes('保存')
              );
              const r = (el) => {
                if (!el) return null;
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                  x: Math.round(b.x), y: Math.round(b.y),
                  w: Math.round(b.width), h: Math.round(b.height),
                  right: Math.round(b.right), bottom: Math.round(b.bottom),
                  scrollW: el.scrollWidth, clientW: el.clientWidth,
                  overflow: cs.overflow, display: cs.display,
                  fontSize: cs.fontSize, lineHeight: cs.lineHeight,
                  padding: cs.padding, text: (el.textContent || '').trim(),
                  disabled: el.disabled === true
                };
              };
              return {
                viewport: window.innerWidth,
                sticky: r(sticky), bar: r(bar), actions: r(actions), button: r(button),
                saveButtons: [...document.querySelectorAll('.settings-sticky button')]
                  .map((item) => (item.textContent || '').trim())
              };
            })()
          `);
          console.log('[save-audit]', JSON.stringify(result));
        } catch (error) {
          console.warn('[save-audit] failed', (error as Error).message);
        }
      }, 6000);
    }

    if (process.env.BSUB_TOOLBAR_AUDIT === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const rows = await win.webContents.executeJavaScript(`
            (async () => {
              const labels = ['字幕', '对话', '总结', '库', '批量', '历史', '设置'];
              const out = [];
              for (const label of labels) {
                const button = [...document.querySelectorAll('button')].find((item) =>
                  (item.textContent || '').trim() === label
                );
                if (!button) continue;
                button.click();
                await new Promise((resolve) => setTimeout(resolve, 350));
                const bar = document.querySelector('.panel-toolbar');
                if (!bar) continue;
                const title = bar.querySelector('.panel-title');
                const actions = bar.querySelector('.toolbar-actions');
                const rect = (el) => (el ? el.getBoundingClientRect() : null);
                const t = rect(title);
                const a = rect(actions);
                out.push({
                  label,
                  barWidth: Math.round(bar.getBoundingClientRect().width),
                  barScroll: bar.scrollWidth,
                  titleWidth: t ? Math.round(t.width) : 0,
                  actionsWidth: a ? Math.round(a.width) : 0,
                  actionsScroll: actions ? actions.scrollWidth : 0,
                  actionsLeft: a ? Math.round(a.left) : 0,
                  titleRight: t ? Math.round(t.right) : 0,
                  overlap: Boolean(t && a && t.right > a.left - 2),
                  buttons: actions ? actions.querySelectorAll('button').length : 0
                });
              }
              return out;
            })()
          `);
          console.log('[toolbar-audit]', JSON.stringify(rows));
        } catch (error) {
          console.warn('[toolbar-audit] failed', (error as Error).message);
        }
      }, 6000);
    }

    if (process.env.BSUB_SUMMARY_UI_TEST === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          await win.webContents.executeJavaScript(`
            (() => {
              const nav = [...document.querySelectorAll('.side-nav-item')].find((item) =>
                (item.textContent || '').includes('总结')
              );
              nav?.click();
              return !!nav;
            })()
          `);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const clicked = await win.webContents.executeJavaScript(`
            (() => {
              const button = [...document.querySelectorAll('.side-content button')].find((item) =>
                ['生成', '重生成'].includes((item.textContent || '').trim())
              );
              button?.click();
              return !!button;
            })()
          `);
          await new Promise((resolve) => setTimeout(resolve, 90000));
          const metrics = await win.webContents.executeJavaScript(`
            (() => {
              const content = document.querySelector('.summary-content');
              const live = document.querySelector('.summary-live');
              const progress = document.querySelector('.summary-progress');
              const chapters = document.querySelector('.chapters-card');
              const verify = document.querySelector('.verify-card');
              const hint = document.querySelector('.summary-verify-hint');
              return {
                clicked: ${clicked},
                contentHeight: content ? content.getBoundingClientRect().height : 0,
                contentText: content ? (content.textContent || '').slice(0, 120) : '',
                liveHeight: live ? live.getBoundingClientRect().height : 0,
                progress: !!progress,
                chapters: chapters
                  ? { open: chapters.open, height: chapters.getBoundingClientRect().height }
                  : null,
                verify: verify
                  ? { text: (verify.textContent || '').slice(0, 120), height: verify.getBoundingClientRect().height }
                  : null,
                hint: hint ? hint.textContent : ''
              };
            })()
          `);
          console.log('[summary-ui-metrics]', JSON.stringify(metrics));
          const image = await win.webContents.capturePage();
          fs.writeFileSync(path.join(app.getPath('temp'), 'bsub-summary-shot.png'), image.toPNG());
        } catch (error) {
          console.warn('[summary-ui-test] failed', (error as Error).message);
        }
      }, 8000);
    }

    if (process.env.BSUB_SETTINGS_SHOT === '1') {
      setTimeout(async () => {
        try {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return;
          const clicked = await win.webContents.executeJavaScript(`
            (() => {
              const button = [...document.querySelectorAll('button')].find((item) =>
                (item.textContent || '').trim().includes('设置')
              );
              if (!button) return false;
              button.click();
              return true;
            })()
          `);
          await new Promise((resolve) => setTimeout(resolve, 1600));
          const metrics = await win.webContents.executeJavaScript(`
            (() => {
              const panel = document.querySelector('.settings-panel');
              const sidebar = document.querySelector('.sidebar');
              const sticky = document.querySelector('.settings-sticky');
              const sections = [...document.querySelectorAll('.settings-section')];
              const overflow = [...document.querySelectorAll('.settings-panel *')]
                .filter((el) => el.scrollWidth > el.clientWidth + 2)
                .slice(0, 12)
                .map((el) => ({
                  tag: el.tagName,
                  cls: String(el.className || '').slice(0, 40),
                  sw: el.scrollWidth,
                  cw: el.clientWidth
                }));
              return {
                sidebar: sidebar ? sidebar.getBoundingClientRect().width : 0,
                panel: panel ? panel.getBoundingClientRect().width : 0,
                panelScroll: panel ? panel.scrollWidth : 0,
                sticky: sticky ? sticky.getBoundingClientRect().height : 0,
                nav: document.querySelector('.side-nav')?.getBoundingClientRect().height || 0,
                content:
                  document.querySelector('.side-content')?.getBoundingClientRect().height || 0,
                sections: sections.length,
                open: sections.filter((item) => item.open).length,
                overflow
              };
            })()
          `);
          console.log('[settings-metrics]', JSON.stringify(metrics));
          const image = await win.webContents.capturePage();
          const file = path.join(app.getPath('temp'), 'bsub-settings-shot.png');
          fs.writeFileSync(file, image.toPNG());
          console.log('[settings-shot]', clicked, file);
        } catch (error) {
          console.warn('[settings-shot] failed', (error as Error).message);
        }
      }, 6000);
    }

    if (process.env.BSUB_PLATFORM_CONN_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          const platform = settings.search.platforms.find(
            (item) => item.id === settings.search.activeId
          );
          if (!platform) throw new Error('没有活动检索平台');
          const result = await testPlatformConnection('search', platform);
          console.log('[platform-conn-test]', JSON.stringify(result));
        } catch (error) {
          console.warn('[platform-conn-test] failed', (error as Error).message);
        }
      }, 6000);
    }

    if (process.env.BSUB_PLATFORM_TEST === '1') {
      setTimeout(() => {
        const settings = loadSettings();
        const search = settings.search.platforms.find(
          (platform) => platform.id === settings.search.activeId
        );
        const ai = settings.ai.platforms.find(
          (platform) => platform.id === settings.ai.activeId
        );
        console.log(
          '[platform-test]',
          JSON.stringify({
            ai: settings.ai.platforms.length,
            aiActive: ai?.name,
            aiModels: ai?.models?.length || 0,
            search: settings.search.platforms.length,
            searchActive: search?.name,
            searchKind: search?.kind,
            searchReuse: search?.reuseAiKey || '',
            asr: settings.asr.platforms.length,
            asrActive: settings.asr.platforms.find(
              (platform) => platform.id === settings.asr.activeId
            )?.name,
            aiPresetVersion: settings.ai.presetVersion
          })
        );
      }, 3000);
    }

    if (process.env.BSUB_SEARCH_TEST === '1') {
      setTimeout(async () => {
        try {
          const settings = loadSettings();
          const refs = await searchWeb(
            { ...settings, search: { ...settings.search, enabled: true, activeId: 'exa' } },
            'B站 视频 总结'
          );
          console.log(
            '[search-test]',
            refs.length,
            JSON.stringify(refs.map((ref) => ({ title: ref.title.slice(0, 40), url: ref.url })))
          );
        } catch (error) {
          console.warn('[search-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_SETTINGS_TEST === '1') {
      setTimeout(async () => {
        if (!mainWindow) return;
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const r = await window.bsub.getSettings();
            const s = r.data.settings;
            s.general.theme = 'dark';
            s.general.suspendMinutes = 7;
            s.ai.platforms = s.ai.platforms.filter((p) => p.id !== 'openai');
            s.ai.activeId = 'deepseek';
            s.ai.temperature = 0.7;
            s.prompt.templates.push({ id: 'test-tpl', name: '测试模板', text: '只输出一句话' });
            s.prompt.activeId = 'test-tpl';
            s.export.filenamePattern = '{title}-{bvid}';
            return await window.bsub.saveSettings(s);
          })()`);
          console.log('[settings-test]', JSON.stringify(result).slice(0, 600));
        } catch (error) {
          console.warn('[settings-test] failed', (error as Error).message);
        }
      }, 5000);
    }

    if (process.env.BSUB_UI_TEST === '1') {
      setTimeout(() => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        tabManager?.zoomIn();
        console.log('[ui-test] zoom', wc.getZoomFactor());
        tabManager?.zoomReset();
        console.log('[ui-test] zoom reset', wc.getZoomFactor());
        tabManager?.findInPage('视频');
        setTimeout(() => tabManager?.findInPage('视频', { findNext: true }), 1200);
      }, 7000);
    }

    if (process.env.BSUB_TAB_TEST === '1') {      setTimeout(async () => {
        if (!tabManager) return;
        await tabManager.create('https://www.bilibili.com/');
        await tabManager.create('https://www.bilibili.com/video/BV1xrnz6gEVD');
        setTimeout(() => {
          const list = tabManager?.list() || [];
          const total = app
            .getAppMetrics()
            .reduce(
              (sum, metric) => sum + Math.round(((metric.memory && metric.memory.workingSetSize) || 0) / 1024),
              0
            );
          console.log(
            '[tabs-test]',
            JSON.stringify(list.map((tab) => ({ title: tab.title, suspended: tab.suspended, active: tab.active }))),
            `memMB=${total}`
          );

          const target = list.find((tab) => tab.suspended);
          if (target && tabManager) {
            void tabManager.activate(target.id).then(() => {
              setTimeout(() => {
                const after = tabManager?.list() || [];
                console.log(
                  '[tabs-test] resumed',
                  JSON.stringify(
                    after.map((tab) => ({ title: tab.title, suspended: tab.suspended, active: tab.active }))
                  )
                );
              }, 4000);
            });
          }
        }, 10000);
      }, 4000);
    }

    if (process.env.BSUB_M4_TEST === '1') {
      setTimeout(async () => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        try {
          const info = await getPageInfo(wc);
          const bundle = await getSubtitles(wc);
          const track =
            bundle.tracks.find((item) => info.cid && item.url.includes(String(info.cid))) ||
            bundle.tracks[0];
          if (!track) {
            console.log('[m4-test] no track');
            return;
          }
          const body = await getTrackBody(track.url);

          const platform = {
            id: 'mock',
            name: 'Mock',
            baseUrl: 'http://127.0.0.1:8787/v1',
            apiKey: 'test',
            model: 'mock-summary'
          };
          let streamed = '';
          const result = await summarize({
            info,
            lines: body.lines,
            platform,
            prompt: '请总结以下字幕。',
            onDelta: (delta) => {
              streamed += delta;
            }
          });
          console.log(
            '[m4-test] ai',
            `chars=${result.text.length}`,
            `streamed=${streamed.length}`,
            result.text.slice(0, 40)
          );

          const saved = saveSummary(info, result.text, result.model);
          console.log('[m4-test] saved', JSON.stringify(saved));
          const stored = getSummaryFor({ bvid: info.bvid, cid: info.cid, epId: info.epId });
          console.log(
            '[m4-test] stored',
            stored ? `${stored.content.length} chars / ${stored.model}` : 'null'
          );

          const markdown = buildExport({
            format: 'md',
            info,
            track,
            lines: body.lines,
            summary: result.text
          });
          const srt = buildExport({ format: 'srt', info, track, lines: body.lines });
          const outDir = path.join(app.getAppPath(), 'out');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, 'test-export.md'), markdown.content, 'utf8');
          fs.writeFileSync(path.join(outDir, 'test-export.srt'), srt.content, 'utf8');
          console.log(
            '[m4-test] export',
            `md=${markdown.content.length}`,
            `srt=${srt.content.length}`,
            `${markdown.filename}.${markdown.ext}`
          );

          const snapshot = settingsSnapshot();
          console.log(
            '[m4-test] settings',
            `platforms=${snapshot.settings.ai.platforms.length}`,
            `dataDir=${snapshot.dataDir}`
          );

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('library:changed');
            await mainWindow.webContents.executeJavaScript(
              `document.querySelectorAll('.side-nav-item')[1] && document.querySelectorAll('.side-nav-item')[1].click()`
            );
          }
        } catch (error) {
          console.warn('[m4-test] failed', (error as Error).message);
        }
      }, 12000);
    }

    if (process.env.BSUB_M3_TEST === '1') {
      setTimeout(async () => {
        const wc = tabManager?.activeWebContents();
        if (!wc) return;
        try {
          const info = await getPageInfo(wc);
          const bundle = await getSubtitles(wc);
          const track =
            bundle.tracks.find((item) => info.cid && item.url.includes(String(info.cid))) ||
            bundle.tracks[0];
          if (!track) {
            console.log('[m3-test] no track');
            return;
          }
          const body = await getTrackBody(track.url);
          const result = ingestVideo({ info, track, lines: body.lines });
          console.log('[m3-test] ingest', JSON.stringify(result));
          console.log('[m3-test] stats', JSON.stringify(listLibrary().stats));
          const two = searchLibrary('折叠');
          const three = searchLibrary('折叠屏');
          console.log('[m3-test] search2', two.mode, two.total, two.matches[0]?.text);
          console.log('[m3-test] search3', three.mode, three.total, three.matches[0]?.text);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('library:changed');
            await mainWindow.webContents.executeJavaScript(
              `document.querySelectorAll('.side-nav-item')[2] && document.querySelectorAll('.side-nav-item')[2].click()`
            );
          }
        } catch (error) {
          console.warn('[m3-test] failed', (error as Error).message);
        }
      }, 12000);
    }
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log('[renderer]', `[${level}]`, message, `${sourceId}:${line}`);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.warn('[renderer] gone', details);
    });
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const diag = await mainWindow.webContents.executeJavaScript(
          `({ api: typeof window.bsub, rootChildren: document.querySelector('#root') ? document.querySelector('#root').children.length : -1, text: (document.body.innerText || '').slice(0, 300) })`
        );
        console.log('[diag]', JSON.stringify(diag));
      } catch (error) {
        console.warn('[diag] failed', (error as Error).message);
      }
    }, 7000);
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const section = process.env.BSUB_START_SECTION;
  if (rendererUrl) {
    void mainWindow.loadURL(section ? `${rendererUrl}?section=${encodeURIComponent(section)}` : rendererUrl);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      section ? { query: { section } } : undefined
    );
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    // 设置里关掉「关闭到托盘」后，点关闭直接退出。
    if (loadSettings().general.closeToTray === false) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    tabManager?.dispose();
    tabManager = null;
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  writeLog('startup.log', 'ready');
  nativeTheme.themeSource = loadSettings().general.theme;
  if (process.platform === 'win32') app.setAppUserModelId('com.bsub.desktop');
  session.defaultSession.setUserAgent(UA);
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: '保存文件',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename())
    });
  });
  initLibrary();
  writeLog('startup.log', 'library ready');
  createWindow();
  writeLog('startup.log', 'window created');
  createTray();
  if (mainWindow) {
    void startBridge(mainWindow);
    initUpdater(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (mainWindow) void startBridge(mainWindow);
    } else {
      showWindow();
    }
  });
}).catch((error) => {
  fatal('whenReady', error);
});

app.on('before-quit', () => {
  writeLog('startup.log', 'before-quit');
  isQuitting = true;
  disposeUpdater();
  stopBridge();
  closeLibrary();
});

app.on('window-all-closed', () => {
  writeLog('startup.log', 'window-all-closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('render-process-gone', (_event, webContents, details) => {
  writeLog('fatal.log', `render-process-gone ${webContents.getURL()} ${JSON.stringify(details)}`);
});

app.on('child-process-gone', (_event, details) => {
  writeLog('fatal.log', `child-process-gone ${JSON.stringify(details)}`);
});
