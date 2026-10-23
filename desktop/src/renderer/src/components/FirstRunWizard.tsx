import { useState } from 'react';
import { ChevronRight, KeyRound, Play, Sparkles, X } from 'lucide-react';
import type { SettingsSnapshot } from '../../../shared/types';
import { APP_NAME, APP_TAGLINE } from '../../../shared/brand';

export function FirstRunWizard({
  snapshot,
  onFinish
}: {
  snapshot: SettingsSnapshot;
  onFinish: (openSettings: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const settings = snapshot.settings;
  const platform =
    settings.ai.platforms.find((item) => item.id === settings.ai.activeId) ||
    settings.ai.platforms[0];
  const hasKey = Boolean(platform?.apiKey && !/^••••/.test(platform.apiKey));
  const localEndpoint = /127\.0\.0\.1|localhost/i.test(platform?.baseUrl || '');

  const steps = [
    {
      icon: <Sparkles size={22} />,
      title: `欢迎使用 ${APP_NAME}`,
      body: (
        <>
          <p>
            {APP_TAGLINE}：网页、视频、字幕、AI 和本地库在同一个窗口里。
          </p>
          <ul>
            <li>B 站视频有官方字幕就直接抓，没有就用音轨做语音转录；</li>
            <li>任何网页都可以总结、翻译、划词提问（Ctrl+Shift+S）；</li>
            <li>字幕、总结与笔记会存进本地 SQLite 库，可全文搜索。</li>
          </ul>
        </>
      )
    },
    {
      icon: <KeyRound size={22} />,
      title: '配置一个 AI 平台（可选）',
      body: (
        <>
          <p>
            当前平台：<b>{platform?.name || '未选择'}</b>
            {localEndpoint ? (
              <span className="wizard-ok"> · 本地端点，无需 Key</span>
            ) : hasKey ? (
              <span className="wizard-ok"> · Key 已配置</span>
            ) : (
              <span className="wizard-warn"> · 还没有填 Key</span>
            )}
          </p>
          <p className="wizard-muted">
            只抓官方字幕不需要 Key；AI 总结、翻译、校对、语音转录需要。Key 用系统 DPAPI
            加密后保存在本机，不会上传。
          </p>
        </>
      )
    },
    {
      icon: <Play size={22} />,
      title: '开始使用',
      body: (
        <ol className="wizard-steps">
          <li>在地址栏输入 BV 号或打开任意 B 站视频；</li>
          <li>左侧「字幕」页点「抓取」；没有字幕就点「转写」；</li>
          <li>「总结」页生成笔记，或到「设置」调整提示词与平台。</li>
        </ol>
      )
    }
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true">
      <div className="wizard-card">
        <button className="wizard-close" title="关闭" onClick={() => onFinish(false)}>
          <X size={14} />
        </button>

        <div className="wizard-icon">{current.icon}</div>
        <div className="wizard-title">{current.title}</div>
        <div className="wizard-body">{current.body}</div>

        <div className="wizard-dots">
          {steps.map((_, index) => (
            <span key={index} className={index === step ? 'active' : ''} />
          ))}
        </div>

        <div className="wizard-actions">
          {step === 0 ? (
            <button className="primary-btn" onClick={() => setStep(1)}>
              下一步 <ChevronRight size={13} />
            </button>
          ) : step === 1 ? (
            <>
              <button className="mini-btn" onClick={() => setStep(2)}>
                稍后配置
              </button>
              <button className="primary-btn" onClick={() => onFinish(true)}>
                去设置填写
              </button>
            </>
          ) : (
            <button className="primary-btn" onClick={() => onFinish(false)}>
              开始使用
            </button>
          )}
        </div>

        {step < steps.length - 1 && (
          <button className="wizard-skip" onClick={() => onFinish(false)}>
            跳过引导
          </button>
        )}
      </div>
    </div>
  );
}
