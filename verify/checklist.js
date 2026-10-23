// 按维护中的功能清单逐项自检：每项都要能在代码里找到对应实现。
// 输出为勾选清单，便于人工复核。
const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..', 'shizi-extension');
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|json|css|html|md)$/.test(e.name)) files.push(p);
  }
})(EXT);
const src = Object.fromEntries(files.map((f) => [path.relative(EXT, f).split(path.sep).join('/'), fs.readFileSync(f, 'utf8')]));
const ALL = Object.values(src).join('\n');
const inFile = (rel, re) => new RegExp(re, 'm').test(src[rel] || '');

// [分组, 项目, 判定]
const items = [
  ['字幕', '抓取官方字幕', /subtitle\.fetch/.test(ALL) && /getSubtitles/.test(ALL)],
  ['字幕', '页面解析不到时的接口兜底 + 诊断', /subtitle\.api/.test(ALL) && /fetchSubtitleTracks/.test(ALL) && /subtitleDiagnostic/.test(ALL) && /need_login_subtitle|needLogin/.test(ALL)],
  ['字幕', '网络嗅探播放器字幕请求（主环境钩子）', /installSubtitleSniffer/.test(ALL) && /recordSniffedSubtitle/.test(ALL) && /isSubtitleUrl/.test(ALL)],
  ['字幕', '主动触发播放器字幕菜单再重试', /triggerSubtitleMenu/.test(ALL) && /subtitle\.trigger/.test(ALL)],
  ['字幕', 'wbi 签名接口（aid+cid）', /player\/wbi\/v2/.test(ALL) && /getMixinKey/.test(ALL) && /w_rid/.test(ALL)],
  ['字幕', '字幕轨自动选择（中文优先）', inFile('src/sidepanel/modules/subtitles.js', 'LANG_PRIORITY') && /sortCandidates/],
  ['字幕', '时长校验防串分 P', /OVERRUN_RATIO/.test(ALL) && /minCoverageRatio/.test(ALL) && /overrun/.test(ALL)],
  ['字幕', '列多个候选轨并逐个尝试', /attempts\.push/.test(ALL) && /继续尝试|逐个尝试|for \(let idx/.test(ALL)],
  ['字幕', '字幕缓存（去签名做标识）', /subtitleCacheKey/.test(ALL) && /stripQuery/.test(ALL)],
  ['字幕', '字幕搜索 + 高亮', /renderTextWithHighlight/.test(ALL) && /md-mark|mark\.className/.test(ALL)],
  ['字幕', '点击跳转播放位置', /jumpTo/.test(ALL) && /page\.seek/.test(ALL)],
  ['字幕', '复制全部 / 复制单行', /copyAllSubtitles/.test(ALL) && /copyLine/.test(ALL)],
  ['字幕', '单行统计（句数/字数/朗读时长/覆盖时长）', /lineStats/.test(ALL) && /speakSeconds/.test(ALL)],

  ['转录', '无字幕时提供转录入口', /语音转录/.test(ALL) && /transcribe\(\)/.test(ALL)],
  ['转录', '音轨下载（分块 + 进度）', /AudioDownloader/.test(ALL) && /onProgress/.test(ALL) && /audio\.range/.test(ALL)],
  ['转录', '解码 / 单声道 / 16 kHz 重采样', /decodeAudioBytes/.test(ALL) && /toMono16k/.test(ALL) && /targetRate: 16000|16000/.test(ALL)],
  ['转录', '重叠切片 + 合并去重', /planSlices/.test(ALL) && /dedupeAppend/.test(ALL) && /overlapSeconds/.test(ALL)],
  ['转录', '按大小上限自适应分块', /computeSliceSeconds|sizeLimitMB/.test(ALL) && /retryFactor/.test(ALL) && /estimateWavBytes/.test(ALL)],
  ['转录', '无时间戳结果的重叠去重', /segmentPlainText/.test(ALL) && /normalizeForMatch/.test(ALL)],
  ['转录', '终止', /cancelTask|AbortController/.test(ALL) && /已终止/.test(ALL)],
  ['转录', '超时', /timeoutSeconds/.test(ALL) && /makeAbort/.test(ALL)],
  ['转录', '并发数可配置', /concurrency/.test(ALL) && /runPool/.test(ALL)],

  ['AI', '总结（流式 + Markdown 渲染）', /ai\.summarize|generateSummary/.test(ALL) && /chatStream/.test(ALL) && /renderMarkdownInto/.test(ALL)],
  ['AI', '对话（流式 + 渲染 + 重置 + 建议问题）', /sendMessage/.test(ALL) && /resetChat/.test(ALL) && /SUGGESTIONS/.test(ALL)],
  ['AI', '多平台、可增删切换', /添加自定义平台/.test(ALL) && /删除平台|platformDetail/.test(ALL) && /activeId/.test(ALL)],
  ['AI', '平台用下拉框选择（不再平铺全部）', /platformPicker/.test(ALL) && /editPlatform_/.test(ALL) && /__add__/.test(ALL)],
  ['AI', '默认 DeepSeek', /id: 'deepseek'/.test(ALL) && /activeId: 'deepseek'/.test(ALL)],
  ['AI', '每个平台独立配置', /baseUrl/.test(ALL) && /model/.test(ALL) && /apiKey/.test(ALL)],
  ['AI', '官网链接', /homepage: 'https:\/\//.test(ALL) && /官网/.test(ALL)],
  ['AI', '测试连接', /platform\.test/.test(ALL) && /测试连接/.test(ALL)],
  ['AI', '自动探测模型列表', /platform\.models/.test(ALL) && /探测模型/.test(ALL) && /class: 'tag'/.test(ALL)],
  ['AI', '密钥本机保存 + 掩码 + 留空不改动', /storage\.local/.test(ALL) && /maskSecret/.test(ALL) && /留空/.test(ALL)],
  ['AI', '自定义地址申请域名权限', /permissions\.request/.test(ALL) && /申请域名权限/.test(ALL)],

  ['提示词', '指定的默认系统提示词（原文照录）', src['src/shared/constants.js'].includes('整理这期视频的内容（可以用表格、代码块、高亮块、引用、超链接、公式、图片等飞书支持的格式输出，可以加上一些图标增加可读性）')],
  ['提示词', '可修改', /prompt\.templates/.test(ALL) && /textarea/.test(ALL)],
  ['提示词', '多套模板', /defaultPrompts/.test(ALL) && /新建模板/.test(ALL)],

  ['优化', 'AI 优化字幕', /optimizeWithAi/.test(ALL) && /buildOptimizeMessages/.test(ALL)],
  ['优化', '自动全部替换', /applyAllCorrections|一键全部应用/.test(ALL) && /自动全部进行/.test(ALL)],
  ['优化', '可保存/导出/导入的替换规则组', /exportRuleGroups/.test(ALL) && /parseRuleGroups/.test(ALL) && /新建规则组/.test(ALL)],
  ['优化', '术语表', /glossary/.test(ALL) && /术语表/.test(ALL)],
  ['优化', '优化时联网核对', /useSearch/.test(ALL) && /gatherSearchEvidence/.test(ALL)],
  ['优化', '转录后自动优化（默认关）', /autoOptimizeAfter: false/.test(ALL)],
  ['优化', '转录后自动替换（默认关）', /autoApplyAfter: false/.test(ALL)],

  ['联网', '服务商检索（进 AI 依据）', /search\.provider/.test(ALL) && /searchContextBlock/.test(ALL)],
  ['联网', '直接搜索引擎（不耗额度）', /openEngineSearch/.test(ALL) && /search\.open-engine/.test(ALL)],
  ['联网', '检索来源面板 + 数量', /来源面板/.test(ALL) && /src-row/.test(ALL)],
  ['联网', '按来源统计引用次数', /countCitations/.test(ALL) && /cite-count/.test(ALL)],
  ['联网', '检索服务商/Key/引擎/结果数/是否抓正文可配置', /SEARCH_ENGINES/.test(ALL) && /maxResults/.test(ALL) && /fetchPageContent/.test(ALL)],

  ['反馈', '进度条含任务名 + 百分比', /job-percent/.test(ALL) && /TASK_LABEL/.test(ALL) && /第 \$\{i\}\/\$\{total\} 片|第 .*\/.* 片/.test(ALL)],
  ['反馈', '终止按钮', /终止/.test(ALL) && /cancelTask/.test(ALL)],
  ['反馈', '全局超时', /METHOD_TIMEOUT/.test(ALL) && /makeAbort/.test(ALL)],
  ['反馈', '配置状态常驻提示', /computeReadiness/.test(ALL) && /readiness/.test(ALL)],

  ['导出', 'SRT / WebVTT / ASS / TXT / Markdown / JSON', ['toSrt', 'toVtt', 'toAss', 'toTxt', 'toMarkdown', 'toJson'].every((f) => new RegExp(f).test(ALL))],
  ['导出', '4 种模板', /EXPORT_TEMPLATES/.test(ALL) && /study/.test(ALL) && /meeting/.test(ALL)],
  ['导出', '保留时间戳开关', /includeTimestamps/.test(ALL)],

  ['质量与批量', 'AI 章节/分段 + 点击跳转', /generateChapters/.test(ALL) && /chapters/.test(ALL) && /seek\(c\.start\)/.test(ALL)],
  ['质量与批量', '质量自检', /qualityCheck/.test(ALL) && /质量自检/.test(ALL)],
  ['质量与批量', '批量队列（暂停/移除/进度）', /batchAdd/.test(ALL) && /batchPause/.test(ALL) && /batchRemove/.test(ALL) && /runBatchQueue/.test(ALL)],
  ['质量与批量', '历史记录', /historyList/.test(ALL) && /historyPut/.test(ALL) && /历史记录/.test(ALL)],
  ['质量与批量', '缓存复用开关', /useLocalCache/.test(ALL) && /优先使用本地缓存/.test(ALL)],

  ['页面内', '播放器内嵌按钮（可开关、提示词可配）', /__bsub_player_btn__/.test(ALL) && /playerButtonPrompt/.test(ALL)],
  ['页面内', '页面内显示字幕', /setOverlay/.test(ALL) && /__bsub_overlay__/.test(ALL)],
  ['页面内', '跟随播放（高亮 + 自动滚动 + 暂停/恢复）', /followPlayback/.test(ALL) && /syncActive/.test(ALL) && /followPaused/.test(ALL)],

  ['界面', '两列布局 + 窄屏单列', /data-mode/.test(ALL) && /420/.test(ALL)],
  ['界面', '分区独立滚动', /scroll-host/.test(ALL) && /overflow: auto/.test(src['src/sidepanel/panel.css'] || '')],
  ['界面', '朴素简洁的外观', /border-radius: 4px|--radius: 4px/.test(ALL) && !/box-shadow: 0 \d+px \d+px rgba\(0, 0, 0, 0\.3\)/.test(ALL)],
  ['界面', '主题（跟随系统/浅色/深色）', /data-theme/.test(ALL) && /prefers-color-scheme/.test(ALL)],
  ['界面', '字号缩放', /fontScale/.test(ALL) && /--fs/.test(ALL)],
  ['界面', '布局切换', /cycleLayout/.test(ALL) && /auto.*two.*one/.test(ALL)],
  ['界面', '行内操作（悬停出现）', /st-actions/.test(ALL) && /\.subtitle-row:hover \.st-actions/.test(src['src/sidepanel/panel.css'] || '')],
  ['界面', '快捷键面板', /SHORTCUTS/.test(ALL) && /shortcut-row/.test(ALL)],
  ['界面', '首次向导（可跳过、入口常驻）', /跳过向导/.test(ALL) && /首次向导/.test(ALL) && /wizardDone/.test(ALL)],
  ['界面', '显式保存按钮', /保存设置/.test(ALL) && /persistDraft/.test(ALL)],
  ['界面', '构建指纹', /BUILD_MODULES/.test(ALL) && /BUILD_TIME/.test(ALL) && /构建指纹/.test(ALL)],
  ['界面', '诊断信息可复制', /diagnostics/.test(ALL) && /复制诊断信息/.test(ALL)],

  ['稳定性①', '布尔显示属性序列化为字符串', /setBoolAttr/.test(ALL) && /String\(v\)|value \? 'true' : 'false'/.test(ALL) && /value \? 'true' : 'false'/.test(ALL)],
  ['稳定性②', '完整 flex 高度链 + 滚动容器不用 flex', /min-height: 0/.test(ALL) && /\.scroll-host \{[\s\S]*?display: block/.test(src['src/sidepanel/panel.css'] || '')],
  ['稳定性③', '遮罩 pointer-events: none', /pointer-events: none/.test(src['src/sidepanel/panel.css'] || '') && /root\.style\.pointerEvents = 'none'/.test(ALL)],
  ['稳定性④', '「是否已配置」用后台结果', /apiKeySet/.test(ALL) && /computeReadiness/.test(ALL)],
  ['稳定性⑤', '保留展开状态与滚动位置', /setGroupOpen/.test(ALL) && /setScroll/.test(ALL) && /bsub\.uiState/.test(ALL)],
  ['稳定性⑥', '版本握手 + 自动重注入', /CONTENT_VERSION/.test(ALL) && /bsub:ping/.test(ALL) && /ensureContentScript/.test(ALL)],
  ['稳定性⑦', '候选标签页逐个降级', /collectCandidateTabs/.test(ALL) && /callOnBestTab/.test(ALL) && /逐个降级|逐个尝试/.test(ALL)],
  ['稳定性⑧', '主环境桥接读页面数据', JSON.stringify(JSON.parse(src['manifest.json']).content_scripts).includes('MAIN') && /__BSUB_PAGE_BRIDGE__/.test(ALL) && /__bsub_page_channel__/.test(ALL)],
  ['稳定性⑨', '页面类型声明与支持一致', /bangumi/.test(ALL) && /'list'/.test(ALL) && /合集|collection/.test(ALL) && JSON.parse(src['manifest.json']).content_scripts.every((c) => c.matches.some((m) => /bilibili\.com/.test(m)))],
  ['稳定性⑩', 'SPA 导航检测（视频 ID + 分 P 签名）', /pushState/.test(ALL) && /popstate/.test(ALL) && /hashchange/.test(ALL) && /p\$\{idx\}|@p\$\{/.test(ALL)],
  ['稳定性⑪', '错误分类为可操作提示', /classifyHttp/.test(ALL) && /classifyNetwork/.test(ALL) && /action:/.test(ALL)],
  ['稳定性⑫', '字幕失败原因区分并带明细', /attempts/.test(ALL) && /候选轨明细|wrongPart/.test(ALL) && /kind === 'overrun'|kind = 'overrun'/.test(ALL)]
];

const groups = new Map();
for (const [g, name, ok] of items) {
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push({ name, ok: !!ok });
}

let total = 0;
let passed = 0;
console.log('===== 功能清单逐项自检 =====\n');
for (const [g, list] of groups) {
  console.log(`【${g}】`);
  for (const it of list) {
    total += 1;
    if (it.ok) passed += 1;
    console.log(`  ${it.ok ? '[x]' : '[ ]'} ${it.name}`);
  }
  console.log('');
}
console.log(`合计 ${total} 项，已实现 ${passed} 项${passed === total ? '（全部覆盖）' : `，缺失 ${total - passed} 项`}`);
process.exit(passed === total ? 0 : 1);
