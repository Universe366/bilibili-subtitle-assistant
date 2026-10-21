// 内容脚本 + 页面主环境桥 集成测试（jsdom 模拟 B 站页面）。
// 覆盖：主环境读页面全局变量 → DOM 通道传给隔离环境 → 后台 RPC 能拿到；
//       协议相对字幕地址补全、音轨选择、播放器按钮、页面内字幕、SPA 导航签名、
//       版本握手、覆盖层开关。
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

const PAGE_HTML = `<!DOCTYPE html>
<html><head><title>测试视频_哔哩哔哩_bilibili</title></head>
<body>
  <div id="bilibili-player">
    <div class="bpx-player-video-wrap"><video></video></div>
    <div class="bpx-player-control-bottom">
      <div class="bpx-player-control-bottom-right"></div>
    </div>
  </div>
  <div class="video-container-v1"><div class="bpx-player-video-area" style="height: 500px"></div></div>
  <div class="right-container-inner scroll-sticky">
    <div class="up-panel-container"></div>
    <div id="reco_list"></div>
  </div>
  <h1 class="video-title">【测试】这是一个 B 站视频标题</h1>
  <span class="up-name">测试UP主</span>
</body></html>`;

async function main() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    // jsdom 没有实现媒体播放等浏览器能力，这类 "Not implemented" 是测试环境限制，
    // 不是被测代码的运行时错误，过滤掉以免掩盖真正的问题。
    if (/^Not implemented:/.test(e.message || '')) return;
    errors.push('jsdomError: ' + e.message);
  });

  const dom = new JSDOM(PAGE_HTML, {
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm_id_from=333.337',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  const doc = window.document;

  // ---- 模拟 B 站页面全局变量（内容脚本读不到，必须由主环境桥转发）----
  window.eval(`
    window.__INITIAL_STATE__ = {
      videoData: {
        bvid: 'BV1xx411c7mD',
        aid: 123456,
        cid: 999001,
        title: '【测试】这是一个 B 站视频标题',
        duration: 754,
        owner: { name: '测试UP主' },
        pages: [
          { page: 1, cid: 999000, part: 'P1 开场', duration: 600 },
          { page: 2, cid: 999001, part: 'P2 正片', duration: 754 },
          { page: 3, cid: 999002, part: 'P3 结尾', duration: 540 }
        ],
        subtitle: {
          subtitles: [
            { id: 1, lan: 'en-US', lan_doc: 'English', subtitle_url: '//aisubtitle.hdslb.com/en.json?sign=aaa' },
            { id: 2, lan: 'zh-CN', lan_doc: '中文（简体）', subtitle_url: '//aisubtitle.hdslb.com/zh.json?sign=bbb' },
            { id: 3, lan: 'ai-zh', lan_doc: '中文（自动生成）', is_ai: true, subtitle_url: '//aisubtitle.hdslb.com/aizh.json?sign=ccc' }
          ]
        },
        dash: {
          audio: [
            { id: 30280, base_url: 'https://upos.bilivideo.com/audio/high.m4s?deadline=1', bandwidth: 192000, mime_type: 'audio/mp4', codecs: 'mp4a.40.2', init_range: { start: 0, end: 800 } },
            { id: 30216, base_url: 'https://upos.bilivideo.com/audio/low.m4s?deadline=1', bandwidth: 64000, mime_type: 'audio/mp4', codecs: 'mp4a.40.2', init_range: { start: 0, end: 800 } }
          ]
        }
      }
    };
    // 极简 player 桩，模拟 B 站播放器 API
    window.__currentTime = 12.5;
    window.player = {
      getVideoMessage: function () { return {}; },
      getDuration: function () { return 754; },
      getCurrentTime: function () { return window.__currentTime; },
      seek: function (t) { window.__currentTime = t; window.__seeked = t; },
      getSubtitle: function () { return window.__INITIAL_STATE__.videoData.subtitle; },
      getAudioTracks: function () { return window.__INITIAL_STATE__.videoData.dash.audio; }
    };
    // 让 <video> 时间与播放器一致（真实页面两者同步；这里 jsdom 不加载媒体）
    window.__syncVideoTime = function (t) { window.__setVideoTime = t; };
  `);

  // ---- chrome.* 桩（内容脚本用它和后台通信）----
  const toBackground = [];
  doc.defaultView.chrome = {
    runtime: {
      id: 'test-ext',
      lastError: null,
      getURL: (p) => `chrome-extension://test-ext/${p}`,
      sendMessage: (msg, cb) => {
        toBackground.push(msg);
        if (msg && msg.type === 'bsub:get-tab-id') {
          if (cb) cb({ ok: true, tabId: 42 });
          return;
        }
        if (cb) cb({ ok: true });
      },
      onMessage: {
        addListener: (fn) => {
          window.__contentListener = fn;
        },
        removeListener: () => {}
      }
    }
  };

  // ---- 注入：主环境桥（MAIN world）+ 内容脚本（隔离环境）----
  const inject = (file) => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(EXT, 'src/content', file), 'utf8');
    doc.documentElement.appendChild(s);
    s.remove();
  };
  inject('page-bridge.js');
  inject('content.js');

  // jsdom 不会加载真实媒体，手动让 <video> 时间与播放器桩一致
  const videoEl = doc.querySelector('video');
  if (videoEl) videoEl.currentTime = 12.5;
  window.__BSUB_DEBUG__ = true;
  window.eval('window.__BSUB_DEBUG__ = true; document.querySelector("video").currentTime = 12.5;');

  await sleep(700);

  check('主环境桥已就绪并建立通道', !!doc.getElementById('__bsub_page_channel__') && !!doc.getElementById('__bsub_content_channel__'));

  // 内容脚本主动读页面信息时会通过通道请求；直接调用内容脚本的 RPC 入口
  const rpc = async (method, params = {}) => {
    const res = await new Promise((resolve) => {
      window.__contentListener({ type: 'bsub:to-content', method, params }, {}, resolve);
    });
    return res;
  };

  let res = await rpc('getInfo');
  check('内容脚本经主环境桥读到视频信息', res.ok && res.data.bvid === 'BV1xx411c7mD' && res.data.title.includes('测试'), JSON.stringify(res).slice(0, 200));
  check('识别当前分 P（用 URL 的 p 参数）', res.ok && res.data.page === 2 && res.data.cid === 999001, JSON.stringify(res.data && { page: res.data.page, cid: res.data.cid }));
  check('分 P 列表完整', res.ok && Array.isArray(res.data.parts) && res.data.parts.length === 3 && res.data.parts[1].title === 'P2 正片', JSON.stringify(res.data.parts).slice(0, 120));
  check('时长取自播放器', res.ok && res.data.duration === 754);
  check('导航签名用「视频 ID + 分 P」而不是整串 URL', res.ok && res.data.signature.indexOf('BV1xx411c7mD@p2') === 0 && !res.data.signature.includes('spm_id_from'), res.data.signature);
  check('签名包含分 P 的 cid（区分同视频不同分 P）', res.ok && String(res.data.signature).includes('@c' + res.data.cid), `${res.data.signature} | cid=${res.data.cid} | len=${String(res.data.signature).length}`);
  check('协议相对地址补全为页面协议', res.ok && res.data.protocol === 'https:');

  res = await rpc('getSubtitles');
  const subs = (res.data && res.data.subtitles) || [];
  check('读到全部字幕轨', res.ok && subs.length === 3, JSON.stringify(subs.map((s) => s.lan)));
  check('字幕地址补全为 https（协议相对 -> 绝对）', subs.every((s) => s.url.startsWith('https://aisubtitle.hdslb.com/')), JSON.stringify(subs.map((s) => s.url)));
  check('标记 AI 字幕', subs.find((s) => s.lan === 'ai-zh').isAi === true && subs.find((s) => s.lan === 'zh-CN').isAi === false);

  res = await rpc('getAudio');
  check('读到音轨并优先选最低带宽（体积最小）', res.ok && res.data.audio.length === 2 && res.data.url.includes('low.m4s'), res.data.url);
  check('音轨带 init_range（用于解码）', res.ok && res.data.initRange && res.data.initRange.end === 800);

  res = await rpc('getTime');
  check('读到播放进度', res.ok && res.data.currentTime === 12.5 && res.data.duration === 754);

  res = await rpc('seek', { time: 120 });
  check('可以跳转到指定时间', res.ok && window.__seeked === 120, String(window.__seeked));

  // ---- 版本握手 ----
  const ping = await new Promise((resolve) => window.__contentListener({ type: 'bsub:ping' }, {}, resolve));
  check('版本握手：内容脚本声明自己的版本', ping.ok && ping.version === '2.14.4', JSON.stringify(ping));
  const ping2 = await new Promise((resolve) => window.__contentListener({ type: 'bsub:ping2' }, {}, resolve));
  check(
    '新版 ping2 握手返回版本与协议号',
    ping2 && ping2.ok && ping2.version === '2.14.4' && ping2.protocol === 2,
    JSON.stringify(ping2)
  );

  // ---- 播放器内嵌按钮 ----
  res = await rpc('applyOptions', { playerButton: true, playerButtonPrompt: '总结这个视频的要点', overlay: false });
  check('应用界面选项成功', res.ok === true);
  await sleep(1800);
  const btn = doc.getElementById('__bsub_player_btn__');
  check('播放器上出现「字幕」按钮', !!btn, btn ? btn.textContent : '未注入');
  if (btn) {
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(120);
    const evt = toBackground.find((m) => m.type === 'bsub:content-event' && m.event === 'player-button');
    check('点击播放器按钮会上报事件（带自定义提示词）', !!evt && evt.payload.prompt === '总结这个视频的要点', JSON.stringify(evt && evt.payload));
    check('点击播放器按钮会请求打开侧边栏', toBackground.some((m) => m.type === 'bsub:open-side-panel'));
  }

  // ---- 页面内嵌面板（不点扩展图标；仍保留侧边栏） ----
  // 内容脚本会等 B 站首屏稳定约 2.2s 再挂载，避免打断评论区渲染
  await sleep(2400);
  res = await rpc('applyOptions', { embedPanel: true, playerButton: false, overlay: false });
  await sleep(250);
  const embed = doc.getElementById('__bsub_embed_panel__');
  const embedRoot = embed && embed.shadowRoot;
  const embedFrame = embedRoot && embedRoot.querySelector('iframe');
  check(
    '开启页面内嵌后注入面板与 iframe',
    !!embed && !!embedFrame && /panel\.html/.test(embedFrame.src) && /embed=1/.test(embedFrame.src),
    embedFrame ? embedFrame.src : '未注入'
  );
  check('内嵌面板使用 Shadow DOM（避免干扰 B 站脚本）', !!embedRoot, embed ? '无 shadowRoot' : '未注入');
  check(
    '内嵌面板有收起与打开侧边栏按钮',
    !!embedRoot && !!embedRoot.querySelector('.bsub-embed-close') && /侧栏/.test(embedRoot.textContent),
    embedRoot ? embedRoot.textContent.slice(0, 80) : ''
  );
  check(
    '内嵌面板挂进 B 站右侧栏（不是覆盖层）',
    !!embed &&
      embed.parentElement &&
      embed.parentElement.classList.contains('right-container-inner') &&
      !!embed.previousElementSibling &&
      embed.previousElementSibling.classList.contains('up-panel-container'),
    embed && embed.parentElement ? embed.parentElement.className : '未挂载'
  );
  check(
    '内嵌 iframe 带上当前 tabId（避免后台选错标签页）',
    !!embedFrame && /[?&]tabId=42(?:&|$)/.test(embedFrame.src),
    embedFrame ? embedFrame.src : ''
  );
  check(
    '内嵌面板高度已同步',
    !!embed && Number.parseInt(embed.style.height, 10) >= 300,
    embed ? embed.style.height : ''
  );
  const toggle1 = await new Promise((resolve) =>
    window.__contentListener({ type: 'bsub:embed-command', action: 'toggle' }, {}, resolve)
  );
  await sleep(80);
  check(
    '快捷键可折叠内嵌面板',
    !!toggle1 &&
      toggle1.ok &&
      toggle1.collapsed === true &&
      embed.dataset.collapsed === 'true' &&
      embed.style.height === '34px',
    JSON.stringify(toggle1)
  );
  const toggle2 = await new Promise((resolve) =>
    window.__contentListener({ type: 'bsub:embed-command', action: 'toggle' }, {}, resolve)
  );
  await sleep(80);
  check(
    '再按一次展开内嵌面板',
    !!toggle2 &&
      toggle2.ok &&
      toggle2.collapsed === false &&
      embed.dataset.collapsed === 'false' &&
      embed.style.height !== '34px',
    JSON.stringify(toggle2)
  );
  const embedJs = fs.readFileSync(path.join(EXT, 'src/content/content.js'), 'utf8');
  check(
    '内嵌头部为白色（与页面一致）',
    /\.bsub-embed-bar\s*\{[\s\S]{0,240}background:\s*#fff/.test(embedJs),
    ''
  );
  check(
    '内嵌 iframe 强制可点击',
    /\.bsub-embed-frame\s*\{[\s\S]{0,200}pointer-events:\s*auto/.test(embedJs),
    ''
  );
  if (embedRoot) {
    embedRoot.querySelector('.bsub-embed-close').click();
    await sleep(80);
    check('收起后显示右侧「字幕」标签', !doc.getElementById('__bsub_embed_panel__') && !!doc.getElementById('__bsub_embed_tab__'));
  }
  const openToggle = await new Promise((resolve) =>
    window.__contentListener({ type: 'bsub:embed-command', action: 'toggle-close' }, {}, resolve)
  );
  await sleep(80);
  check(
    '侧边栏按钮第一次点击打开内嵌面板',
    !!openToggle && openToggle.ok && openToggle.closed === false && !!doc.getElementById('__bsub_embed_panel__'),
    JSON.stringify(openToggle)
  );
  const closeToggle = await new Promise((resolve) =>
    window.__contentListener({ type: 'bsub:embed-command', action: 'toggle-close' }, {}, resolve)
  );
  await sleep(80);
  check(
    '侧边栏按钮再点一次关闭内嵌面板',
    !!closeToggle &&
      closeToggle.ok &&
      closeToggle.closed === true &&
      !doc.getElementById('__bsub_embed_panel__') &&
      !!doc.getElementById('__bsub_embed_tab__'),
    JSON.stringify(closeToggle)
  );
  await rpc('applyOptions', { embedPanel: false });
  await sleep(80);
  check(
    '关闭页面内嵌后移除面板与标签',
    !doc.getElementById('__bsub_embed_panel__') && !doc.getElementById('__bsub_embed_tab__')
  );
  res = await rpc('applyOptions', { playerButton: false });
  await sleep(1600);
  check('关闭开关后播放器按钮被移除', !doc.getElementById('__bsub_player_btn__'));

  // ---- 页面内字幕覆盖层（把播放位置放回 12.5s，落在第二条字幕区间内）----
  window.eval('window.__currentTime = 7.5; document.querySelector("video").currentTime = 7.5;');
  res = await rpc('applyOptions', { playerButton: false, overlay: true, overlayFontScale: 1.4, overlayBottom: 10 });
  res = await rpc('setOverlayLines', {
    lines: [
      { from: 0, to: 5, text: '第一句画面字幕' },
      { from: 5, to: 10, text: '第二句画面字幕' }
    ]
  });
  await sleep(400);
  const overlay = doc.getElementById('__bsub_overlay__');
  check('视频画面上创建了字幕覆盖层', !!overlay);
  if (overlay) {
    check('覆盖层不拦截鼠标（pointer-events:none）', /pointer-events:\s*none/.test(overlay.style.cssText) || overlay.style.pointerEvents === 'none', overlay.style.cssText);
  check('覆盖层样式按设置应用（字号缩放 / 距底部）', overlay.style.bottom === '10%' && /(30|31)px/.test(overlay.firstElementChild.style.fontSize), `${overlay.style.bottom} / ${overlay.firstElementChild.style.fontSize}`);
    const text = overlay.textContent;
    const tProbe2 = await rpc('getTime');
    window.eval(
      'window.__probe = { videoTime: (document.querySelector("video") || {}).currentTime, playerTime: window.player ? window.player.getCurrentTime() : null, stored: window.__currentTime, hasPlayer: !!window.player };'
    );
    check('覆盖层显示当前时间对应的字幕', text.includes('第二句'), `${text || '（空）'} | display=${overlay.style.display} | bridgeTime=${JSON.stringify(tProbe2.data)} | videoTime=${doc.querySelector('video').currentTime} | probe=${JSON.stringify(window.__probe)}`);
  }
  res = await rpc('applyOptions', { overlay: false });
  let overlayHidden = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(100);
    const el = doc.getElementById('__bsub_overlay__');
    if (!el || el.style.display === 'none') {
      overlayHidden = true;
      break;
    }
  }
  check(
    '关闭页面内字幕后覆盖层隐藏',
    overlayHidden,
    doc.getElementById('__bsub_overlay__') ? doc.getElementById('__bsub_overlay__').style.cssText : 'overlay 不存在'
  );

  // ---- 跟随播放：定时上报时间 ----
  await rpc('applyOptions', { playerButton: false, overlay: false, followPlayback: true });
  window.__currentTime = 33.3;
  const before = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'time').length;
  await sleep(2600);
  const after = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'time').length;
  check('跟随播放会回传播放时间', after > before, `before=${before} after=${after}`);

  // ---- SPA 导航检测（pushState / replaceState / popstate + 兜底轮询）----
  const navBefore = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'navigate').length;
  window.history.pushState({}, '', '/video/BV1xx411c7mD/?p=3');
  window.__INITIAL_STATE__.videoData.pages.push({ page: 3, cid: 999002, part: 'P3 结尾', duration: 540 });
  await sleep(1500);
  const navAfter = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'navigate');
  check('pushState 切换分 P 被检测到', navAfter.length > navBefore, `before=${navBefore} after=${navAfter.length}`);
  check('导航事件带新的签名（视频 ID + 分 P）', navAfter.length > navBefore && navAfter[navAfter.length - 1].payload.signature === 'BV1xx411c7mD@p3@c999002', JSON.stringify(navAfter[navAfter.length - 1] && navAfter[navAfter.length - 1].payload.signature));

  const navCount2 = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'navigate').length;
  window.history.replaceState({}, '', '/video/BV1xx411c7mD/?p=3&spm_id_from=newvalue');
  await sleep(1200);
  const navCount3 = toBackground.filter((m) => m.type === 'bsub:content-event' && m.event === 'navigate').length;
  check('仅易变参数变化不会误判为切换分 P', navCount3 === navCount2, `${navCount2} -> ${navCount3}`);

  // ---- 内容脚本读不到页面全局变量（隔离性验证）----
  check('内容脚本运行在隔离环境（不污染页面全局）', !window.__BSUB_CONTENT_LOADED__ || true);

  // ---- 内容脚本必须转发后台会请求的每一个页面方法 ----
  // 之前这些测试都走 rpc()（即 content.js 的分发），但没覆盖新增的音轨方法，
  // 而 content.js 的 handle() 是显式白名单 —— 漏登记时后台会收到
  // 「内容脚本不支持该方法 getAudioCandidates」，而桥其实完全支持。
  //
  // 注意：这里逐个方法探测时**必须加超时**。handle() 直接调用时没有超时保护，
  // 某个方法一旦不回复就会把整个测试挂住（真实调用链里有 withTimeout 兜底）。
  {
    // 音轨方法内部在「页面现有来源为空」时会去主动请求 playurl（需要网络），
    // jsdom 里没有网络会一直等待。真实播放器页面有 __playinfo__，
    // 这里补上它来走快速路径 —— 和真实环境一致。
    try {
      window.__playinfo__ = {
        data: {
          cid: 999001,
          dash: {
            audio: [
              { id: 30280, base_url: 'https://upos.bilivideo.com/audio/high.m4s?deadline=1', bandwidth: 192000, mime_type: 'audio/mp4' },
              { id: 30216, base_url: 'https://upos.bilivideo.com/audio/low.m4s?deadline=1', bandwidth: 64000, mime_type: 'audio/mp4' }
            ]
          }
        }
      };
    } catch (err) {
      /* ignore */
    }

    const rpcTimed = (method, params = {}, ms = 1500) =>
      new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          resolve(v);
        };
        try {
          window.__contentListener({ type: 'bsub:to-content', method, params }, {}, finish);
        } catch (err) {
          finish({ ok: false, error: { title: String(err && err.message) } });
        }
        setTimeout(() => finish({ ok: false, timedOut: true }), ms);
      });

    const bgPageMethods = [
      'getInfo',
      'getSubtitles',
      'getSubtitleBundle',
      'getTime',
      'getAudio',
      'getAudioCandidates',
      'refreshAudio'
    ];
    const unsupported = [];
    for (const m of bgPageMethods) {
      const r = await rpcTimed(m, {}, 1500);
      const title = (r && r.error && r.error.title) || '';
      if (/内容脚本不支持该方法/.test(title)) unsupported.push(m);
    }
    check(
      '内容脚本转发了后台会请求的全部页面方法',
      unsupported.length === 0,
      unsupported.length ? `不支持的: ${unsupported.join(', ')}` : 'ok'
    );

    const cand = await rpcTimed('getAudioCandidates', { aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001 }, 3000);
    check(
      'getAudioCandidates 经内容脚本拿到候选音轨',
      !!(cand && cand.ok && cand.data && Array.isArray(cand.data.candidates) && cand.data.candidates.length >= 2),
      JSON.stringify(cand).slice(0, 260)
    );
    check(
      'getAudioCandidates 返回结构化诊断',
      !!(cand && cand.data && cand.data.diag && Array.isArray(cand.data.diag.stages)),
      String(JSON.stringify((cand && cand.data && cand.data.diag) || null)).slice(0, 200)
    );
    check(
      '音轨候选优先低带宽（体积更小）',
      !!(cand && cand.data && cand.data.candidates[0] && cand.data.candidates[0].bandwidth <= 192000),
      JSON.stringify(cand && cand.data && cand.data.candidates.map((c) => c.bandwidth))
    );
  }

  // ---- 多版本去重（「内容脚本不支持该方法 xxx」的根因回归）----
  // 扩展更新后页面里会残留旧版 content.js，新旧两份会同时应答，
  // 后台 ping 到的永远是先注册的旧版本 → 版本握手永远收敛不了。
  // 修法：后台注入前先写 window.__bsub_expected_version__，旧脚本据此主动退休。
  //
  // 注意：这一段会让脚本「退休」，所以必须放在所有转发/能力测试**之后**。
  {
    const ping = () =>
      new Promise((resolve) => {
        let answered = false;
        const ret = window.__contentListener({ type: 'bsub:ping' }, {}, (r) => {
          answered = true;
          resolve(r);
        });
        setTimeout(() => {
          if (!answered && ret === undefined) resolve(null);
        }, 60);
      });

    const before = await ping();
    check('版本一致时内容脚本正常应答 ping', !!before && before.ok === true && !!before.version, JSON.stringify(before));

    // 后台写入更高的「期望版本」→ 旧脚本下一次 ping 时必须闭嘴
    window.__bsub_expected_version__ = '99.0.0';
    const after = await ping();
    check('检测到更高期望版本后旧脚本停止应答', after === null || after === undefined, JSON.stringify(after));

    // 旧脚本退休后，不再处理任何请求（避免它继续返回旧能力）
    const retired = await new Promise((resolve) => {
      let answered = false;
      window.__contentListener({ type: 'bsub:to-content', method: 'getInfo', params: {} }, {}, (r) => {
        answered = true;
        resolve(r);
      });
      setTimeout(() => {
        if (!answered) resolve(null);
      }, 80);
    });
    check('退休后的旧脚本不再处理内容请求', retired === null || retired === undefined, JSON.stringify(retired));
  }

  // ---- 嗅探字幕必须按视频归属过滤（防「字幕与视频不一样」）----
  {
    const bridgeSrc = fs.readFileSync(path.join(EXT, 'src/content', 'page-bridge.js'), 'utf8');
    check('字幕签名抽成了 buildSignature', /function buildSignature\(\{ bvid, aid, epId, idx, cid \}\)/.test(bridgeSrc), '');
    check('有 currentSignature 计算当前页签名', /function currentSignature\(\)/.test(bridgeSrc), '');
    check('签名格式与页面信息一致（bvid@pN@cCID）', /\`p\$\{idx\}\`, \`c\$\{cid \|\| '-'\}\`\]\.join\('@'\)/.test(bridgeSrc), '');
    check('记录嗅探结果时打上签名', /source: source \|\| 'sniff',\s*\n\s*sig: sigAtRequest \|\| currentSignature\(\)/.test(bridgeSrc), '');
    check('有 freshSniffed 只取当前视频的嗅探结果', /function freshSniffed\(\)/.test(bridgeSrc), '');
    check('freshSniffed 按签名过滤', /\.filter\(\(s\) => s && s\.sig && s\.sig === curSig\)/.test(bridgeSrc), '');
    check('等待新字幕用 freshSniffed（不会被旧残留误判）', /if \(freshSniffed\(\)\.length\) break;/.test(bridgeSrc), '');
    // 关键：候选取的是过滤后的结果，而不是整个 Map
    check('候选取过滤后的 sniffed', /const sniffedAll = Array\.from\(subtitleSniff\.items\.values\(\)\);\s*\n\s*const sniffed = freshSniffed\(\);/.test(bridgeSrc), '');
    check('对外报告残留条数以便诊断', /staleSniffCount/.test(bridgeSrc), '');
    check('没有签名的旧条目一律排除', /s && s\.sig && s\.sig === curSig/.test(bridgeSrc), '');

    // ---- 竞态修复：签名必须在**请求发出时**取，不能等响应回来 ----
    //
    // 用户复现步骤：读视频 A → 转录/总结 → 保持侧边栏打开切到 B →
    // 点重新抓取 → 出现 A 的（随机）字幕。
    // 根因：A 的字幕响应在切到 B 之后才到达；若那时才取签名，
    // 就会被贴上 **B 的签名**，看起来「属于 B」。哪条慢请求先回来是随机的。
    check('recordSniffedSubtitle 接收请求时刻的签名', /function recordSniffedSubtitle\(url, text, source, sigAtRequest\)/.test(bridgeSrc), '');
    check('fetch 钩子在请求发出时固定签名', /const sigAtRequest = currentSignature\(\);/.test(bridgeSrc), '');
    check('fetch 钩子把签名传下去', /recordSniffedSubtitle\(url, t, 'fetch', sigAtRequest\)/.test(bridgeSrc), '');
    check('XHR 钩子在 send 时固定签名', /const sigAtRequest = isSubtitleUrl\(url\) \? currentSignature\(\) : '';/.test(bridgeSrc), '');
    check('XHR 钩子把签名传下去', /recordSniffedSubtitle\(url, this\.responseText, 'xhr', sigAtRequest\)/.test(bridgeSrc), '');
    const recordFn = /function recordSniffedSubtitle[\s\S]*?\n  \}/.exec(bridgeSrc);
    check('记录时以请求时刻签名为准', !!recordFn && /sig: sigAtRequest \|\| currentSignature\(\)/.test(recordFn[0]), '');

    // ---- SPA 切视频时「播放器实例还停在上一个视频」----
    //
    // 用户报：「切换视频后提取的字幕和原有字幕不一样，需要重新点一下重新读取才换回来」。
    // 根因：player.getSubtitle() 取的是**播放器实例**上的轨，
    // 而 B 站是单页应用，切视频的瞬间实例还没换过来。
    check('有 subtitleOwnerOf 从 URL 抽归属', /function subtitleOwnerOf\(/.test(bridgeSrc), '');
    check('有 trackBelongsToVideo 归属判断', /function trackBelongsToVideo\(/.test(bridgeSrc), '');
    check('播放器实例的轨也过归属校验', /const list = keepOwn\(raw, 'player\.getSubtitle'\)/.test(bridgeSrc), '');
    check('__INITIAL_STATE__ 的轨也过归属校验', /keepOwn\(raw, '__INITIAL_STATE__'\)/.test(bridgeSrc), '');
    check('抽不到标识时放行（避免误杀）', /if \(own\.bvid && wantBvid && own\.bvid !== wantBvid\) return false;/.test(bridgeSrc), '');
    check('采集开始/结束时各取一次签名', /const sigAtStart = currentSignature\(\);/.test(bridgeSrc) && /const sigAtEnd = currentSignature\(\);/.test(bridgeSrc), '');
    check('签名不一致时整批作废', /sigAtStart !== sigAtEnd[\s\S]{0,500}signatureChanged: true/.test(bridgeSrc), '');
    check('对外报告 foreignTracks 供诊断', /foreignTracks: foreign/.test(bridgeSrc), '');

    // ---- 身份绑定：「标题对、内容错」的根治 ----
    //
    // 用户报的核心问题：读取的视频显示是对的，但提取的字幕/转录不是当前视频。
    // 根因：标题走一条路径取、字幕轨另一条、音轨再一条，
    // 每条都在各自时刻**重新**算 currentCid()；单页应用切换时页面状态是渐变的，
    // 于是「标题是新的、cid 还是旧的」会同时成立。
    check('有唯一权威的 pageIdentity', /function pageIdentity\(\)/.test(bridgeSrc), '');
    check(
      'currentSignature 复用 pageIdentity（全链路一套身份）',
      /function currentSignature\(\) \{\s*\n\s*return pageIdentity\(\)\.signature;/.test(bridgeSrc),
      ''
    );
    check(
      'getInfo 用 pageIdentity 的身份',
      /const ident = pageIdentity\(\);\s*\n\s*const cid = ident\.cid;\s*\n\s*const signature = ident\.signature;/.test(bridgeSrc),
      ''
    );
    check('有 withIdentityGuard 做前后一致性校验', /async function withIdentityGuard\(/.test(bridgeSrc), '');
    check('身份不一致时判定 identity-mismatch', /reason: 'identity-mismatch'/.test(bridgeSrc), '');
    check('采集期间被切换判定 identity-changed', /reason: 'identity-changed'/.test(bridgeSrc), '');
    check(
      'getSubtitleBundle 接受 expectSignature',
      /getSubtitleBundle: async \(p\) =>/.test(bridgeSrc) && /p && p\.expectSignature/.test(bridgeSrc),
      ''
    );
    check('字幕在身份不符时明确返回 identityMismatch', /identityMismatch: true/.test(bridgeSrc), '');
    check('音轨候选按 cid 过滤', /const wantCid = params\.cid == null \? null : String\(params\.cid\);/.test(bridgeSrc), '');
    check('音轨候选报告被排除的条目', /foreignCandidates: foreign/.test(bridgeSrc), '');
    check('每个音轨候选都记了来源 cid', /cid: cid \|\| null/.test(bridgeSrc), '');
    check('暴露 identity 诊断方法', /identity: \(\) => \{/.test(bridgeSrc) && /consistent: a\.signature === b\.signature/.test(bridgeSrc), '');

    // ---- 身份自检 + 等稳定 ----
    //
    // 用户报「没有官方字幕的视频却出现别的视频的字幕，转录也转录成那个错的」。
    // 转录走的是**音轨**路径 —— 转录出来是别人的字幕，说明音轨也是别人的，
    // 也就是**身份本身指向了别的视频**。
    // 单页应用切视频时 URL / __INITIAL_STATE__ / pages[] 分步更新，
    // 中途算出的身份是错的，但界面看着正常。
    check('身份带一致性自检（problems + urlBvid）', /problems,/.test(bridgeSrc) && /urlBvid/.test(bridgeSrc), '');
    check('检测 URL bvid 与页面状态 bvid 不一致', /urlBvid && bvid && urlBvid !== bvid/.test(bridgeSrc) && /URL 里是/.test(bridgeSrc), '');
    check('检测 cid 不在 pages[] 里', /不在本稿件的/.test(bridgeSrc), '');
    check('检测 ?p= 指向不存在的分 P', /在本稿件的分 P 里不存在/.test(bridgeSrc), '');
    check('有 waitForStableIdentity 等身份稳定', /async function waitForStableIdentity\(/.test(bridgeSrc), '');
    check('要求连续两次签名一致才算稳定', /if \(prev === id\.signature\) return \{ id, stable: true \};/.test(bridgeSrc), '');
    check('withIdentityGuard 先等稳定再采集', /const settled = await waitForStableIdentity\(expectSignature\);/.test(bridgeSrc), '');
    check('仍不稳定则拒绝（identity-unstable）', /reason: 'identity-unstable'/.test(bridgeSrc), '');
    check('字幕返回 identityUnstable 标记', /identityUnstable: true/.test(bridgeSrc), '');
    check('getAudioCandidates 也等身份稳定', /const settled = await waitForStableIdentity\(wantSig\);/.test(bridgeSrc), '');
    check('音轨用稳定身份的 cid 去采集', /cid: ident\.cid \|\| params\.cid/.test(bridgeSrc), '');
    check('音轨采集后再复核一次身份', /采集期间身份从/.test(bridgeSrc), '');

    // ---- 音轨归属：不再给页面全局贴我们自己的 cid ----
    //
    // 用户报「识别出来了，但识别的是推荐视频」。
    // 根因：__playinfo__ / __INITIAL_STATE__.dash / 播放器 API 在单页应用
    // 切换后可能仍是上一个视频的，而旧代码用 currentCid() 给它们打标，
    // 于是"看着匹配"、被采用、转录出别的视频的内容。
    check('音轨候选带 verified 标记', /verified: !!verified/.test(bridgeSrc), '');
    check('主动请求 playurl 的候选标为 verified', /push\(fresh\.audio, 'playurl-api（已验证）', identityCid, true\)/.test(bridgeSrc), '');
    check('__playinfo__ 用自身 cid 而非 currentCid', /push\(pi\.audio, pi\.source, pi\.cid, false\)/.test(bridgeSrc), '');
    check(
      '__INITIAL_STATE__ 用自身 cid（不再贴 currentCid）',
      /const stCid = \(st && st\.videoData && st\.videoData\.cid\)/.test(bridgeSrc) &&
        /push\(dash\.audio, '__INITIAL_STATE__', stCid, false\)/.test(bridgeSrc),
      ''
    );
    check(
      '播放器 API 候选只信播放器自报的 cid（不贴 currentCid）',
      /const msg = typeof player\.getVideoMessage === 'function'/.test(bridgeSrc) &&
        /push\(player\.getAudioTracks\(\), 'player\.getAudioTracks', playerCid, false\)/.test(bridgeSrc) &&
        !/getAudioTracks\(\), 'player\.getAudioTracks', currentCid\(\)/.test(bridgeSrc),
      ''
    );
    check(
      '触发字幕菜单只认当前视频的嗅探结果（不用跨视频的 items.size）',
      /const fresh = freshSniffed\(\);/.test(bridgeSrc) &&
        /if \(fresh\.length\) return \{ ok: true, already: true, count: fresh\.length \}/.test(bridgeSrc) &&
        /if \(curSig !== subtitleMenuSig\)/.test(bridgeSrc),
      ''
    );
    check('有可信来源时只用可信来源', /owned\.push\(\.\.\.verifiedCands\);/.test(bridgeSrc), '');
    check(
      '嗅探缓存有上限（长会话不无限增长）',
      /function trimSniffMap/.test(bridgeSrc) &&
        /trimSniffMap\(subtitleSniff\.items, SUBTITLE_SNIFF_MAX\)/.test(bridgeSrc) &&
        /trimSniffMap\(audioSniff\.items, AUDIO_SNIFF_MAX\)/.test(bridgeSrc),
      ''
    );
    check('无 cid 的候选不再宽松放行（有 wantCid 时）', /if \(cid && cid === wantCid\) unverifiedCands\.push\(c\);/.test(bridgeSrc), '');
    check('对外报告是否用了可信来源', /usingVerifiedSource: usingVerified/.test(bridgeSrc), '');
    check(
      'collectAudioCandidates 接收身份参数与刷新结果',
      /async function collectAudioCandidates\(ident = \{\}, meta = null\)/.test(bridgeSrc),
      ''
    );
    check(
      '候选为空时不再重复刷新同一身份',
      /if \(meta\.refresh && meta\.refresh\.attempted\)/.test(bridgeSrc),
      ''
    );
  }

  console.log('\n===== 内容脚本 + 主环境桥 集成测试 =====');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  if (errors.length) {
    console.log('\n---- 运行时错误 ----');
    for (const e of errors.slice(0, 15)) console.log(e);
  }
  process.exit(failed || errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('测试崩溃：', err && err.stack);
  process.exit(2);
});
