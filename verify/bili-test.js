// B 站字幕链路专项测试：bili.js 的 wbi 签名、多种 JSON 形状解析、字幕轨来源合并。
// 用真实接口返回形状（从 api.bilibili.com 实测抄录）做断言。
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..', 'bilibili-subtitle-assistant');
const results = [];
const check = (name, ok, extra = '') => results.push({ name, ok: !!ok, extra });

// ---- 真实形状样本（实测自 api.bilibili.com） ----
const NAV_RESPONSE = {
  code: 0,
  data: {
    wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
    }
  }
};

// 无字幕时 player/v2 的真实返回
const PLAYER_V2_EMPTY = {
  code: 0,
  message: 'OK',
  data: {
    aid: 117346526039650,
    bvid: 'BV1E6aq6pEKR',
    cid: 42264170483,
    login_mid: 0,
    need_login_subtitle: true,
    subtitle: { allow_submit: false, lan: '', lan_doc: '', subtitles: [], subtitle_position: null }
  }
};

// 有字幕时的典型返回（形状与官方一致）
const PLAYER_V2_WITH_SUBS = {
  code: 0,
  message: 'OK',
  data: {
    aid: 123456,
    bvid: 'BV1xx411c7mD',
    cid: 999001,
    need_login_subtitle: false,
    subtitle: {
      allow_submit: true,
      lan: 'zh-CN',
      lan_doc: '中文（简体）',
      subtitles: [
        { id: 1001, lan: 'zh-CN', lan_doc: '中文（简体）', is_lock: false, subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/zh.json?auth_key=1', type: 0, id_str: '1001', ai_status: 0 },
        { id: 1002, lan: 'ai-zh', lan_doc: '中文（自动生成）', is_lock: false, subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/ai-zh.json?auth_key=2', type: 1, id_str: '1002', ai_status: 2 }
      ]
    }
  }
};

const VIEW_RESPONSE = {
  code: 0,
  message: 'OK',
  data: {
    aid: 123456,
    bvid: 'BV1xx411c7mD',
    cid: 999001,
    title: '测试视频',
    duration: 754,
    owner: { name: '测试UP' },
    pages: [
      { page: 1, cid: 999000, part: 'P1', duration: 600 },
      { page: 2, cid: 999001, part: 'P2', duration: 754 }
    ],
    subtitle: { allow_submit: true, list: [] }
  }
};

// 字幕正文：三种真实形状
const BODY_SHAPES = {
  'body-array': { body: [{ from: 0.5, to: 2.0, content: '第一句' }, { from: 2.0, to: 4.0, content: '第二句' }] },
  'data-body': { code: 0, data: { body: [{ from: 0.5, to: 2.0, content: '第一句' }, { from: 2.0, to: 4.0, content: '第二句' }] } },
  'plain-array': [{ from: 0.5, to: 2.0, content: '第一句' }, { from: 2.0, to: 4.0, content: '第二句' }],
  'start-text': { body: [{ start: 0.5, end: 2.0, text: '第一句' }, { start: 2.0, end: 4.0, text: '第二句' }] },
  'result-body': { result: { body: [{ from: 0.5, to: 2.0, content: '第一句' }, { from: 2.0, to: 4.0, content: '第二句' }] } },
  'track-list-not-body': { data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//x/1.json' }, { lan: 'en', subtitle_url: '//x/2.json' }] } } }
};

let fetchLog = [];
function installFetch(handlers) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    fetchLog.push({ url: u, headers: init.headers || {}, method: init.method || 'GET' });
    for (const [re, fn] of handlers) {
      if (re.test(u)) {
        const out = fn(u, init);
        return new Response(typeof out === 'string' ? out : JSON.stringify(out), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
    return new Response('not mocked: ' + u, { status: 404 });
  };
}

async function main() {
  const BILI = await import(pathToFileURL(path.join(EXT, 'src/background/bili.js')).href);
  const MD5 = await import(pathToFileURL(path.join(EXT, 'src/shared/md5.js')).href);

  // ---- 1. MD5 正确性（wbi 签名的基础）----
  check('md5("") 正确', MD5.md5('') === 'd41d8cd98f00b204e9800998ecf8427e', MD5.md5(''));
  check('md5("abc") 正确', MD5.md5('abc') === '900150983cd24fb0d6963f7d28e17f72', MD5.md5('abc'));
  check('md5 中文（UTF-8）正确', MD5.md5('中文') === 'a7bac2239fcdcb3a067903d8077c4a07', MD5.md5('中文'));
  check(
    'md5 长文本正确',
    MD5.md5('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6',
    MD5.md5('The quick brown fox jumps over the lazy dog')
  );

  // ---- 2. 字幕轨解析（真实形状）----
  const tracksFrom = BILI.__testTracksFrom || null;

  installFetch([
    [/x\/web-interface\/nav/, () => NAV_RESPONSE],
    [/x\/player\/wbi\/v2/, () => PLAYER_V2_WITH_SUBS],
    [/x\/player\/v2/, () => PLAYER_V2_WITH_SUBS],
    [/x\/web-interface\/view/, () => VIEW_RESPONSE]
  ]);

  let out = await BILI.fetchSubtitleTracks({ aid: 123456, bvid: 'BV1xx411c7mD', cid: 999001, pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  check('抓到 2 条字幕轨', out.tracks.length === 2, JSON.stringify(out.tracks.map((t) => t.lan)));
  check('协议相对字幕地址补全为 https', out.tracks.every((t) => t.url.startsWith('https://')), JSON.stringify(out.tracks.map((t) => t.url)));
  check('标记 AI 字幕', out.tracks.some((t) => t.lan === 'ai-zh' && t.isAi === true));
  check('记录了来源（wbi/v2）', out.sources.includes('wbi/v2'), JSON.stringify(out.sources));
  check('wbi 请求带签名（w_rid + wts）', fetchLog.some((f) => /x\/player\/wbi\/v2/.test(f.url) && /w_rid=/.test(f.url) && /wts=/.test(f.url)), fetchLog.filter((f) => /wbi/.test(f.url)).map((f) => f.url.slice(0, 120)).join('\n'));
  check('请求带 Referer 与 UA', fetchLog.some((f) => /x\/player/.test(f.url) && f.headers.Referer && f.headers['User-Agent']));

  // ---- 3. 登录门槛识别 ----
  fetchLog = [];
  installFetch([
    [/x\/web-interface\/nav/, () => NAV_RESPONSE],
    [/x\/player\/wbi\/v2/, () => PLAYER_V2_EMPTY],
    [/x\/player\/v2/, () => PLAYER_V2_EMPTY],
    [/x\/web-interface\/view/, () => VIEW_RESPONSE]
  ]);
  out = await BILI.fetchSubtitleTracks({ aid: 117346526039650, bvid: 'BV1E6aq6pEKR', cid: 42264170483, pageUrl: 'https://www.bilibili.com/video/BV1E6aq6pEKR' });
  check('无字幕时返回 0 条轨而不是报错', out.tracks.length === 0);
  check('识别出需要登录（need_login_subtitle）', out.needLogin === true, JSON.stringify({ needLogin: out.needLogin }));
  check('仍能拿到视频信息（标题/时长/分P）', !!out.video && out.video.duration === 754 && out.video.pages.length === 2, JSON.stringify(out.video && { d: out.video.duration, p: out.video.pages.length }));

  // ---- 4. wbi 失败时回退 player/v2 ----
  fetchLog = [];
  installFetch([
    [/x\/web-interface\/nav/, () => ({ code: -101, message: '账号未登录', data: {} })],
    [/x\/player\/wbi\/v2/, () => ({ code: -403, message: '访问权限不足' })],
    [/x\/player\/v2/, () => PLAYER_V2_WITH_SUBS],
    [/x\/web-interface\/view/, () => VIEW_RESPONSE]
  ]);
  out = await BILI.fetchSubtitleTracks({ bvid: 'BV1xx411c7mD', cid: 999001, pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  check('wbi 不可用时回退 player/v2 仍拿到字幕', out.tracks.length === 2, JSON.stringify(out.tracks.map((t) => t.lan)));
  check('记录了回退来源', out.sources.includes('player/v2'), JSON.stringify(out.sources));

  // ---- 5. 正文 JSON 形状全兼容 ----
  for (const [name, payload] of Object.entries(BODY_SHAPES)) {
    const lines = BILI.extractLines(payload);
    if (name === 'track-list-not-body') {
      check(`正文解析：${name}（字幕轨列表不应被当成正文）`, lines.length === 0, JSON.stringify(lines));
    } else {
      check(`正文解析：${name}`, lines.length === 2 && lines[0].text === '第一句' && lines[0].from === 0.5, JSON.stringify(lines));
    }
  }
  const jsonTextLines = BILI.extractLines({ body: [{ from: 0, to: 1, content: 'a\nb' }] });
  check('正文里的换行被压成空格', jsonTextLines[0].text === 'a b', JSON.stringify(jsonTextLines));
  check('纯文本正文不崩溃', BILI.extractLines({ body: 'not-json' }).length === 0);

  // ---- 6. 番剧（ep）通过 season 接口换 bvid/cid ----
  fetchLog = [];
  installFetch([
    [/pgc\/view\/web\/season/, () => ({
      code: 0,
      result: { episodes: [{ ep_id: 6384225, aid: 117291379330140, bvid: 'BV13Uem6yEzo', cid: 41999928484 }] }
    })],
    [/x\/web-interface\/nav/, () => NAV_RESPONSE],
    [/x\/player\/wbi\/v2/, () => PLAYER_V2_WITH_SUBS],
    [/x\/player\/v2/, () => PLAYER_V2_WITH_SUBS],
    [/x\/web-interface\/view/, () => VIEW_RESPONSE]
  ]);
  out = await BILI.fetchSubtitleTracks({ epId: 6384225, pageUrl: 'https://www.bilibili.com/bangumi/play/ep6384225' });
  check('番剧页用 ep_id 换到播放地址并拿到字幕', out.tracks.length === 2, JSON.stringify(out.sources));
  check('番剧请求走了 season 接口', fetchLog.some((f) => /pgc\/view\/web\/season/.test(f.url)));

  // ---- 7. 网络异常给出可操作错误 ----
  globalThis.fetch = async () => {
    throw new Error('Failed to fetch');
  };
  let err = null;
  try {
    await BILI.fetchSubtitleTracks({ bvid: 'BV1', cid: 1, pageUrl: 'https://www.bilibili.com/video/BV1' });
  } catch (e) {
    err = e;
  }
  check('全部来源失败时抛错而不是返回空', !!err, err && err.message);
  check('网络错误被归类为可操作提示', !!err && (err.kind === 'network' || err.kind === 'timeout'), err && err.kind);

  // ---- 8. 页面主环境桥里的 MD5（wbi 签名用，必须与标准一致）----
  const fs = require('fs');
  const { JSDOM } = require('jsdom');
  const bridgeSrc = fs.readFileSync(path.join(EXT, 'src/content/page-bridge.js'), 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const s = dom.window.document.createElement('script');
  s.textContent = bridgeSrc;
  dom.window.document.documentElement.appendChild(s);
  const bridge = dom.window.__BSUB_PAGE_BRIDGE__;
  check('页面桥已挂载自检挂钩', !!bridge);
  if (bridge) {
    const md5Cases = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['中文', 'a7bac2239fcdcb3a067903d8077c4a07']
    ];
    let md5Bad = 0;
    for (const [input, want] of md5Cases) {
      const got = bridge.md5Hex(input);
      if (got !== want) {
        md5Bad += 1;
        console.log('  md5 不一致', JSON.stringify(input), got, want);
      }
    }
    check('页面桥内的 MD5 与标准一致（wbi 签名基础）', md5Bad === 0, `失败 ${md5Bad} 例`);
  }
  dom.window.close();

  console.log('\n===== B 站字幕链路专项测试 =====');
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra && !r.ok ? `  -> ${r.extra}` : ''}`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('测试崩溃：', err && err.stack);
  process.exit(2);
});
