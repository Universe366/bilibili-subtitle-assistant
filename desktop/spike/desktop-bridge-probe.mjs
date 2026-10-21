// 独立验证扩展侧 buildDesktopPayload 的字段形状（不启动浏览器）。
globalThis.location = new URL('https://www.bilibili.com/video/BV1xrnz6gEVD');
globalThis.window = { parent: null, addEventListener() {} };
globalThis.chrome = { runtime: { id: 'test-extension' } };

const mod = await import(
  '../../bilibili-subtitle-assistant/src/sidepanel/modules/desktop-bridge.js'
);

const payload = mod.buildDesktopPayload({
  video: {
    bvid: 'BV1xrnz6gEVD',
    cid: 42926145926,
    title: '测试视频',
    owner: '测试 UP',
    duration: 1492,
    url: 'https://www.bilibili.com/video/BV1xrnz6gEVD',
    signature: 'BV1xrnz6gEVD@p1@c42926145926',
    subtitleMeta: { lang: 'ai-zh' }
  },
  subtitles: [
    { from: 0.14, to: 1.1, text: '第一句' },
    { from: 1.1, to: 1.42, text: '第二句' }
  ],
  summary: '## 总结\n- 测试',
  settings: { desktop: { enabled: true, port: 47821, token: 'token' } }
});

console.log(JSON.stringify(payload, null, 2));
