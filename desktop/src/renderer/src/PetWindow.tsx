import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PageInfo } from '../../shared/types';
import happyFish from './assets/pet/push.png';
import idleFish from './assets/pet/keai.png';
import thinkingFish from './assets/pet/go_to_agi.png';

function fallbackInfo(): PageInfo {
  return {
    kind: 'page',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: '桌面',
    owner: '',
    desc: '',
    duration: 0,
    url: '',
    signature: 'pet'
  } as PageInfo;
}

type Emotion = 'idle' | 'thinking' | 'speaking' | 'happy' | 'sleeping';

const QUICK_ACTIONS = [
  { id: 'summary', label: '总结这个页面', prompt: '用 5 条要点总结当前页面，先给结论。' },
  { id: 'explain', label: '解释选中内容', prompt: '解释我当前选中的内容，用通俗的话。' },
  { id: 'translate', label: '翻译选中内容', prompt: '把当前选中的内容翻译成中文（若已是中文则译成英文）。' }
];

const FISH_IMAGE: Record<Emotion, string> = {
  idle: idleFish,
  thinking: thinkingFish,
  speaking: idleFish,
  happy: happyFish,
  sleeping: idleFish
};

const CLICK_PHRASES = ['摸摸头～', 'DeepSeek 大肥鱼在此！', '需要我总结点什么吗？', '别戳啦，会变瘦的'];

const GREETINGS = [
  '要不要把正在看的视频存进库里？',
  '看久了记得起来活动一下。',
  '选中网页文字就能问我。',
  '按 Ctrl+, 可以打开设置。'
];

/** 桌宠窗口：情绪状态、气泡对话、快捷动作、朗读与拖拽。 */
export function PetWindow() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const [speak, setSpeak] = useState(() => localStorage.getItem('pet-speak') === '1');
  const [hint, setHint] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const requestRef = useRef('');
  const happyTimer = useRef<number | null>(null);
  const lastActive = useRef(Date.now());

  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId !== requestRef.current) return;
      setEmotion('speaking');
      setAnswer((previous) => previous + event.delta);
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      setAnswer(event.text);
      setHistory((items) => [...items, { role: 'assistant', text: event.text }]);
      setEmotion('happy');
      if (speak && event.text) {
        try {
          const utterance = new SpeechSynthesisUtterance(event.text.slice(0, 400));
          utterance.lang = 'zh-CN';
          speechSynthesis.cancel();
          speechSynthesis.speak(utterance);
        } catch {
          // 系统不支持语音时忽略
        }
      }
      if (happyTimer.current) window.clearTimeout(happyTimer.current);
      happyTimer.current = window.setTimeout(() => setEmotion('idle'), 2500);
    });
    const offError = window.bsub.onChatError((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      setEmotion('idle');
      setError(event.error);
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, [speak]);

  // 空闲一段时间后进入睡觉状态，并偶尔冒个泡
  useEffect(() => {
    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastActive.current;
      if (busy) return;
      if (idleMs > 5 * 60_000) {
        setEmotion('sleeping');
        return;
      }
      if (idleMs > 90_000 && Math.random() < 0.25) {
        setHint(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
        window.setTimeout(() => setHint(''), 5000);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const toggleSpeak = () => {
    const next = !speak;
    setSpeak(next);
    localStorage.setItem('pet-speak', next ? '1' : '0');
    if (!next) speechSynthesis.cancel();
  };

  const ask = async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    lastActive.current = Date.now();
    setBusy(true);
    setError('');
    setAnswer('');
    setEmotion('thinking');
    setInput('');
    setHistory((items) => [...items, { role: 'user', text: value }]);
    const requestId = `pet-${Date.now()}`;
    requestRef.current = requestId;
    try {
      const page = await window.bsub.getPageInfo();
      const info = page.ok ? page.data : fallbackInfo();
      const messages: ChatMessage[] = [{ role: 'user', content: value }];
      const started = await window.bsub.chat({
        requestId,
        info,
        lines: [],
        messages,
        includePage: true,
        web: false
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setBusy(false);
      setEmotion('idle');
      setError((caught as Error).message);
    }
  };

  return (
    <div className={`pet-root emotion-${emotion}${open ? ' is-open' : ''}`}>
      <div className="pet-grip" title="拖动移动桌宠" />

      {hint && !open && <div className="pet-hint">{hint}</div>}

      {open && (
        <div className="pet-bubble">
          <div className="pet-bubble-head">
            <span>拾字助手</span>
            <div className="pet-bubble-tools">
              <button
                className={`mini-btn${speak ? ' is-active' : ''}`}
                title={speak ? '关闭朗读' : '朗读回答'}
                onClick={toggleSpeak}
              >
                朗读
              </button>
              <button
                className="mini-btn"
                title="隐藏桌宠（可在设置里重新打开）"
                onClick={() => void window.bsub.setPetEnabled(false)}
              >
                隐藏
              </button>
            </div>
          </div>

          <div className="pet-bubble-body">
            {history.slice(-4).map((item, index) => (
              <div key={index} className={`pet-line is-${item.role}`}>
                {item.text}
              </div>
            ))}
            {busy && <div className="pet-line is-assistant pet-stream">{answer || '思考中…'}</div>}
            {error && <div className="pet-line is-error">{error}</div>}
            {!history.length && !busy && !error && (
              <div className="pet-line is-assistant">点下面的快捷动作，或直接问我。</div>
            )}
          </div>

          <div className="pet-quick">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                className="mini-btn"
                disabled={busy}
                onClick={() => void ask(action.prompt)}
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="pet-bubble-input">
            <input
              value={input}
              placeholder="输入问题，Enter 发送"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void ask(input);
                if (event.key === 'Escape') setOpen(false);
              }}
            />
            <button
              className="mini-btn primary"
              disabled={busy || !input.trim()}
              onClick={() => void ask(input)}
            >
              发送
            </button>
          </div>
        </div>
      )}

      <button
        className={`pet-body${busy ? ' is-busy' : ''}`}
        title="点击聊天，双击打开主窗口"
        onClick={() => {
          lastActive.current = Date.now();
          setEmotion('happy');
          if (happyTimer.current) window.clearTimeout(happyTimer.current);
          happyTimer.current = window.setTimeout(() => setEmotion('idle'), 1200);
          if (!open && Math.random() < 0.4) {
            setHint(CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)]);
            window.setTimeout(() => setHint(''), 2600);
          }
          setOpen((value) => !value);
        }}
        onDoubleClick={() => void window.bsub.focusMain()}
      >
        <img className="pet-fish" src={FISH_IMAGE[emotion]} alt="DeepSeek 大肥鱼" draggable={false} />
        {emotion === 'sleeping' && <span className="pet-zzz">z z</span>}
      </button>
    </div>
  );
}
