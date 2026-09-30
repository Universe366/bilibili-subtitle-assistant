// 首次使用向导：必须能随时跳过，且跳过入口常驻可见。
// 「跳过」按钮在向导页脚常驻，「设置 → 向导」按钮也常驻。

import { h, button, toast } from './dom.js';
import { store } from './store.js';
import { call } from './bridge.js';
import { openOverlay, closeOverlays } from './ui.js';
import { app, loadVideo, harvest, transcribe } from './context.js';
import { DEFAULT_SYSTEM_PROMPT } from '../../shared/constants.js';

let step = 0;

const STEPS = [
  {
    title: '欢迎使用 B站字幕助手',
    body: (box) => {
      box.appendChild(h('div', { text: '全部功能都在这个侧边栏里完成，不需要另开设置页。' }));
      box.appendChild(h('div', { class: 'note', text: '三步走：① 打开一个 B 站视频 → ② 获取字幕（没有就语音转录）→ ③ 生成总结 / 对话 / 导出。' }));
    }
  },
  {
    title: '第 1 步：配置 AI 平台（默认 DeepSeek）',
    body: (box) => {
      const st = store.get();
      const ai = st.settings?.ai?.platforms?.find((p) => p.id === st.settings.ai.activeId);
      box.appendChild(
        h('div', {
          text: ai
            ? `当前平台：${ai.name}｜密钥：${ai.apiKey ? '已配置（' + ai.apiKey + '）' : '未配置'}｜模型：${ai.model || '未选择'}`
            : '没有找到 AI 平台配置。'
        })
      );
      if (ai && ai.keyUrl) {
        box.appendChild(
          h('div', { class: 'row tight' }, [
            h('span', { text: '申请 Key：' }),
            h('a', { class: 'md-link', href: ai.keyUrl, target: '_blank', rel: 'noreferrer', text: ai.keyUrl })
          ])
        );
      }
      box.appendChild(
        button('去设置 AI 平台', () => {
          closeOverlays();
          app.panels.settings.render();
          store.set({ activeTab: 'settings' });
          store.setGroupOpen('ai', true);
        }, { small: true, primary: true })
      );
      box.appendChild(h('div', { class: 'note', text: '密钥只保存在本机（不同步）。填完后点「测试连接」确认可用。' }));
    }
  },
  {
    title: '第 2 步：配置语音识别（没有官方字幕时用）',
    body: (box) => {
      const st = store.get();
      const asr = st.settings?.asr?.platforms?.find((p) => p.id === st.settings.asr.activeId);
      box.appendChild(
        h('div', {
          text: asr
            ? `当前平台：${asr.name}｜密钥：${asr.apiKey ? '已配置' : '未配置'}｜模型：${asr.model || '未选择'}`
            : '没有找到语音识别平台配置。'
        })
      );
      box.appendChild(button('去设置语音识别', () => {
        closeOverlays();
        store.set({ activeTab: 'settings' });
        store.setGroupOpen('asr', true);
        app.panels.settings.render();
      }, { small: true }));
      box.appendChild(h('div', { class: 'note', text: '转录可随时终止，终止后不会再消耗额度。' }));
    }
  },
  {
    title: '第 3 步：系统提示词',
    body: (box) => {
      box.appendChild(h('div', { text: '默认系统提示词（可修改、可多套模板）：' }));
      box.appendChild(h('pre', { class: 'md-pre', text: DEFAULT_SYSTEM_PROMPT }));
      box.appendChild(button('去编辑提示词', () => {
        closeOverlays();
        store.set({ activeTab: 'settings' });
        store.setGroupOpen('prompt', true);
        app.panels.settings.render();
      }, { small: true }));
    }
  },
  {
    title: '马上试一下',
    body: (box) => {
      box.appendChild(h('div', { text: '确保已打开一个 B 站视频页面，然后：' }));
      box.appendChild(
        h('div', { class: 'row tight' }, [
          button('读取当前视频', () => { closeOverlays(); loadVideo(); }, { small: true }),
          button('获取字幕', () => { closeOverlays(); harvest(); }, { small: true, primary: true }),
          button('语音转录', () => { closeOverlays(); transcribe(); }, { small: true })
        ])
      );
      box.appendChild(h('div', { class: 'note', text: '提示：也可以直接点 B 站播放器上的「字幕」按钮。' }));
    }
  }
];

export function initWizard() {
  return { open, close };
}

export function open() {
  step = 0;
  render();
}

export function close() {
  closeOverlays();
}

function render() {
  const s = STEPS[step];
  const body = h('div');
  body.appendChild(h('div', { class: 'section-title', text: `${step + 1} / ${STEPS.length}　${s.title}` }));
  s.body(body);
  body.appendChild(h('div', { class: 'note', text: '向导可以随时跳过；「设置 → 向导」里的入口常驻可见，之后还能再打开。' }));

  openOverlay(
    '首次使用向导',
    body,
    [
      { label: '跳过向导', onClick: skip },
      { label: '上一步', onClick: () => { step = Math.max(0, step - 1); render(); } },
      { label: step === STEPS.length - 1 ? '完成' : '下一步', primary: true, onClick: () => {
        if (step === STEPS.length - 1) finish();
        else {
          step += 1;
          render();
        }
      } }
    ],
    { width: '480px', dismissable: false }
  );
}

async function finish() {
  closeOverlays();
  try {
    await call('settings.patch', { path: ['general', 'wizardDone'], value: true });
    await call('settings.patch', { path: ['general', 'firstRun'], value: false });
    store.set({ settings: { ...store.get().settings, general: { ...store.get().settings.general, wizardDone: true, firstRun: false } } });
  } catch (err) {
    /* ignore */
  }
  toast({ title: '向导完成，开始使用吧' }, 'ok');
}

async function skip() {
  closeOverlays();
  try {
    await call('settings.patch', { path: ['general', 'wizardDone'], value: true });
    await call('settings.patch', { path: ['general', 'firstRun'], value: false });
    store.set({ settings: { ...store.get().settings, general: { ...store.get().settings.general, wizardDone: true, firstRun: false } } });
  } catch (err) {
    /* ignore */
  }
  toast({ title: '已跳过向导', detail: '右键侧边栏或点标题栏的「?」都能再次打开。' }, 'ok');
}
