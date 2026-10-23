#!/usr/bin/env node
// 真实浏览器冒烟测试：加载未打包扩展，验证 B 站页面上的内嵌面板、评论区、
// 折叠/关闭和设置页。需要本机 Edge/Chrome + 网络，不放进 `npm test`。
//
// 运行：npm run test:browser:smoke
// 可选：BROWSER_PATH=... VIDEO_URL=... node browser-smoke-test.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const EXT = path.join(__dirname, '..', 'shizi-extension');
const VIDEO_URL = process.env.VIDEO_URL || 'https://www.bilibili.com/video/BV1GJ411x7h7/';
const failures = [];
const passes = [];

function check(name, ok, detail = '') {
  if (ok) {
    passes.push(name);
    console.log(`PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ''}`);
  }
}

function findBrowser() {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

async function waitForServiceWorker(browser, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const t = browser.targets().find((x) => x.type() === 'service_worker' && /service-worker\.js/.test(x.url()));
    if (t) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function main() {
  const executablePath = findBrowser();
  if (!executablePath) {
    console.log('SKIP  找不到 Edge/Chrome，可通过 BROWSER_PATH 指定');
    return;
  }
  console.log(`浏览器：${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1400,900',
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`
    ]
  });
  try {
    const sw = await waitForServiceWorker(browser);
    if (!sw) {
      console.log('SKIP  扩展未加载（Chromium 153+ 可能禁用了 --load-extension）');
      return;
    }
    const worker = await sw.worker();
    const extId = new URL(sw.url()).host;
    await worker.evaluate(async () => {
      const got = await chrome.storage.local.get('bsub.settings.v1');
      const s = got['bsub.settings.v1'] || {};
      s.page = s.page || {};
      s.page.embedPanel = true;
      await chrome.storage.local.set({ 'bsub.settings.v1': s });
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 8000));

    const state1 = await page.evaluate(() => {
      const host = document.getElementById('__bsub_embed_panel__');
      const root = host && host.shadowRoot;
      const comment = document.querySelector('#commentapp');
      return {
        host: !!host,
        shadow: !!root,
        iframe: !!(root && root.querySelector('iframe')),
        collapseBtn: !!(root && root.querySelector('.bsub-embed-collapse')),
        commentH: comment ? comment.getBoundingClientRect().height : null,
        biliComments: !!document.querySelector('bili-comments'),
        hostH: host ? host.style.height : null
      };
    });
    check('内嵌面板已注入 Shadow DOM', state1.host && state1.shadow && state1.iframe, JSON.stringify(state1));
    check('面板存在折叠按钮', state1.collapseBtn, '');
    check('评论区没有被卸载', state1.biliComments && (state1.commentH == null || state1.commentH > 0), JSON.stringify(state1));
    check('页面没有 HierarchyRequestError', !pageErrors.some((x) => /HierarchyRequestError/.test(x)), pageErrors.slice(0, 2).join(' | '));

    // 折叠 / 展开
    await page.evaluate(() => {
      const host = document.getElementById('__bsub_embed_panel__');
      const btn = host && host.shadowRoot && host.shadowRoot.querySelector('.bsub-embed-collapse');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    const collapsed = await page.evaluate(() => {
      const h = document.getElementById('__bsub_embed_panel__');
      return { h: h && h.style.height, data: h && h.dataset.collapsed };
    });
    check('折叠后只保留 34px 标题栏', collapsed.h === '34px' && collapsed.data === 'true', JSON.stringify(collapsed));
    await page.evaluate(() => {
      const h = document.getElementById('__bsub_embed_panel__');
      const btn = h && h.shadowRoot && h.shadowRoot.querySelector('.bsub-embed-collapse');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    const expanded = await page.evaluate(() => {
      const h = document.getElementById('__bsub_embed_panel__');
      return { h: h && h.style.height, data: h && h.dataset.collapsed };
    });
    check('再点一次恢复展开', expanded.h !== '34px' && expanded.data === 'false', JSON.stringify(expanded));

    // 侧边栏按钮的 toggle-close：从扩展页面发消息，避免依赖手动点侧边栏
    const extPage = await browser.newPage();
    await extPage.goto(`chrome-extension://${extId}/_locales/en/messages.json`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront();
    const sendToggle = () =>
      extPage.evaluate(
        () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'bsub:open-embed', action: 'toggle-close' }, resolve))
      );
    const closeRes = await sendToggle();
    await new Promise((r) => setTimeout(r, 700));
    const afterClose = await page.evaluate(() => ({
      host: !!document.getElementById('__bsub_embed_panel__'),
      tab: !!document.getElementById('__bsub_embed_tab__')
    }));
    check(
      '侧边栏 toggle-close 能关闭面板且返回 open:false',
      closeRes && closeRes.ok && closeRes.open === false && !afterClose.host && afterClose.tab,
      `${JSON.stringify(closeRes)} / ${JSON.stringify(afterClose)}`
    );
    const openRes = await sendToggle();
    await new Promise((r) => setTimeout(r, 700));
    const afterOpen = await page.evaluate(() => !!document.getElementById('__bsub_embed_panel__'));
    check(
      '再点一次重新打开并返回 open:true',
      openRes && openRes.ok && openRes.open === true && afterOpen,
      `${JSON.stringify(openRes)} / ${afterOpen}`
    );

    // 设置页真实渲染（扩展页面整页，不是 iframe）
    const panelPage = await browser.newPage();
    const panelErrors = [];
    panelPage.on('pageerror', (e) => panelErrors.push(String(e.message || e)));
    await panelPage.goto(`chrome-extension://${extId}/src/sidepanel/panel.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
    await panelPage.click('[data-tab-btn="settings"]').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const settingsState = await panelPage.evaluate(() => {
      const body = document.getElementById('settings-body');
      return { children: body ? body.children.length : null, text: body ? body.textContent.length : null, tab: document.body.dataset.tab };
    });
    check('设置页渲染出分组', settingsState.tab === 'settings' && settingsState.children > 0 && settingsState.text > 500, JSON.stringify(settingsState));
    check('设置页没有脚本异常', panelErrors.length === 0, panelErrors.slice(0, 2).join(' | '));

    console.log(`\n合计 ${passes.length + failures.length} 项，失败 ${failures.length} 项`);
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('浏览器冒烟测试崩溃：', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
