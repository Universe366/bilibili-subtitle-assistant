import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PageInfo } from '../../shared/types';

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
type PetLayout = 'compact' | 'bubble' | 'widget' | 'menu';

const QUICK_ACTIONS = [
  { id: 'summary', label: '总结这个页面', prompt: '用 5 条要点总结当前页面，先给结论。' },
  { id: 'explain', label: '解释选中内容', prompt: '解释我当前选中的内容，用通俗的话。' },
  { id: 'translate', label: '翻译选中内容', prompt: '把当前选中的内容翻译成中文（若已是中文则译成英文）。' }
];

const SELF_TALK = [
  '要不要把正在看的视频存进库里？',
  '看久了记得起来活动一下。',
  '选中网页文字就能问我。',
  '按 Ctrl+, 可以打开设置。',
  '我在这儿，需要就叫我。',
  '今天也要好好做笔记呀。'
];

const CLICK_PHRASES = ['摸摸头～', '我在呢！', '需要我总结点什么吗？', '别戳啦，会变瘦的'];

/** 与主进程 petGeometry.petLayoutForState 保持一致：气泡 > 菜单 > 挂件 > 紧凑。 */
function layoutForState(open: boolean, widgetOpen: boolean, menuOpen: boolean): PetLayout {
  if (open) return 'bubble';
  if (menuOpen) return 'menu';
  if (widgetOpen) return 'widget';
  return 'compact';
}

interface PetTodo {
  id: number;
  text: string;
  done: boolean;
}

function readTodos(): PetTodo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('pet-todos') || '[]') as PetTodo[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.text === 'string') : [];
  } catch {
    return [];
  }
}

function beep(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
    setTimeout(() => void ctx.close().catch(() => undefined), 400);
  } catch {
    // 音频不可用时静默
  }
}

/** 桌宠窗口：情绪、拖动、气泡对话、快捷动作、朗读、桌面小挂件。 */
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
  const [playing, setPlaying] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(() => localStorage.getItem('pet-widget') === '1');
  const [now, setNow] = useState(() => new Date());
  const [todos, setTodos] = useState<PetTodo[]>(readTodos);
  const [copied, setCopied] = useState(false);
  const requestRef = useRef('');
  const happyTimer = useRef<number | null>(null);
  const lastActive = useRef(Date.now());
  const dragRef = useRef<{ sx: number; sy: number; wx: number; wy: number; moved: boolean } | null>(
    null
  );
  const dragStarted = useRef(false);
  const dragFrame = useRef<number | null>(null);
  const dragTarget = useRef<{ x: number; y: number } | null>(null);
  const [petSize, setPetSize] = useState(96);
  const [soundOn, setSoundOn] = useState(true);
  const [idleTalkOn, setIdleTalkOn] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const bubbleBody = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.bsub.getSettings().then((response) => {
      if (!response.ok) return;
      const general = response.data.settings.general;
      setPetSize(Math.min(180, Math.max(64, general.petSize || 96)));
      setSoundOn(general.petSound !== false);
      setIdleTalkOn(general.petIdleTalk !== false);
      setAlwaysOnTop(general.petAlwaysOnTop !== false);
    });
  }, []);

  // 窗口跟着内容伸缩：关闭气泡后只占桌宠大小，不再用透明区域挡住桌面。
  useEffect(() => {
    void window.bsub.setPetLayout(layoutForState(open, widgetOpen, menuOpen));
  }, [open, widgetOpen, menuOpen]);

  useEffect(() => {
    localStorage.setItem('pet-widget', widgetOpen ? '1' : '0');
  }, [widgetOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('pet-todos', JSON.stringify(todos));
  }, [todos]);

  // 媒体播放联动
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const response = await window.bsub.isMediaPlaying();
      if (alive) setPlaying(response.ok && response.data);
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Esc：先关菜单，再关气泡
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // 回答更新后滚到底部
  useEffect(() => {
    const node = bubbleBody.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [history, answer, error]);

  // 说话/回答事件
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
          // 忽略
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

  // 空闲：睡觉 + 自言自语
  useEffect(() => {
    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastActive.current;
      if (busy) return;
      if (idleMs > 5 * 60_000) {
        setEmotion('sleeping');
        return;
      }
      if (idleTalkOn && idleMs > 60_000) {
        setHint(SELF_TALK[Math.floor(Math.random() * SELF_TALK.length)]);
        window.setTimeout(() => setHint(''), 5000);
      }
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [busy, idleTalkOn]);

  const wake = () => {
    lastActive.current = Date.now();
    if (emotion === 'sleeping') setEmotion('idle');
  };

  const toggleSpeak = () => {
    const next = !speak;
    setSpeak(next);
    localStorage.setItem('pet-speak', next ? '1' : '0');
    if (!next) speechSynthesis.cancel();
  };

  const toggleOpen = () => {
    wake();
    setEmotion('happy');
    if (happyTimer.current) window.clearTimeout(happyTimer.current);
    happyTimer.current = window.setTimeout(() => setEmotion('idle'), 1200);
    if (!open && Math.random() < 0.4) {
      setHint(CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)]);
      window.setTimeout(() => setHint(''), 2600);
    }
    setOpen((value) => !value);
  };

  const ask = async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    wake();
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

  const stop = () => {
    if (!requestRef.current) return;
    void window.bsub.cancelChat(requestRef.current);
    setBusy(false);
    setEmotion('idle');
    setHint('已停止');
    window.setTimeout(() => setHint(''), 2000);
  };

  const glance = async () => {
    const page = await window.bsub.getPageInfo();
    if (!page.ok) {
      setHint('现在没有可识别的页面');
    } else {
      const label = page.data.title || page.data.url || '当前页面';
      setHint(`你在看：${label.slice(0, 40)}`);
    }
    window.setTimeout(() => setHint(''), 5000);
  };

  const togglePlay = async () => {
    const result = await window.bsub.toggleMedia();
    if (result.ok) {
      setPlaying(result.data.playing);
      setHint(result.data.playing ? '继续播放' : '已暂停');
      window.setTimeout(() => setHint(''), 2000);
    }
  };

  const copyAnswer = async () => {
    const text = answer || [...history].reverse().find((item) => item.role === 'assistant')?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setHint('复制失败');
      window.setTimeout(() => setHint(''), 2000);
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = await window.bsub.setPetAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(next !== false);
    setHint(next !== false ? '已置顶' : '已取消置顶');
    window.setTimeout(() => setHint(''), 2000);
  };

  const startDrag = (event: React.MouseEvent) => {
    // 只响应左键；气泡里的输入框等元素不要触发拖动。
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,button,.pet-bubble,.pet-widget,.pet-menu')) return;
    dragStarted.current = false;
    dragTarget.current = null;
    void window.bsub.petPosition().then((position) => {
      if (!position) return;
      dragRef.current = {
        sx: event.screenX,
        sy: event.screenY,
        wx: position.x,
        wy: position.y,
        moved: false
      };
    });
    const flush = () => {
      dragFrame.current = null;
      const point = dragTarget.current;
      if (!point) return;
      void window.bsub.movePet(point.x, point.y);
    };
    const move = (moveEvent: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = moveEvent.screenX - state.sx;
      const dy = moveEvent.screenY - state.sy;
      if (!state.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        state.moved = true;
        dragStarted.current = true;
      }
      if (!state.moved) return;
      dragTarget.current = { x: state.wx + dx, y: state.wy + dy };
      if (dragFrame.current == null) dragFrame.current = window.requestAnimationFrame(flush);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (dragFrame.current != null) {
        window.cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      const point = dragTarget.current;
      dragRef.current = null;
      dragTarget.current = null;
      // 松手时吸附边缘并落盘，拖动过程中不写设置。
      if (point && dragStarted.current) {
        void window.bsub.dropPet(point.x, point.y);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      className={`pet-root emotion-${emotion}${open ? ' is-open' : ''}${playing ? ' is-playing' : ''}`}
      style={{ ['--pet-size' as string]: `${petSize}px` }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen((value) => !value);
      }}
      onMouseEnter={wake}
    >
      {menuOpen && (
        <div className="pet-menu" onMouseLeave={() => setMenuOpen(false)}>
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.focusMain();
            }}
          >
            打开主窗口
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void ask(QUICK_ACTIONS[0].prompt);
            }}
          >
            总结当前页面
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void togglePlay();
            }}
          >
            {playing ? '暂停播放' : '继续播放'}
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void toggleAlwaysOnTop();
            }}
          >
            {alwaysOnTop ? '取消置顶' : '窗口置顶'}
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.resetPetPosition();
            }}
          >
            重置位置
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.setPetEnabled(false);
            }}
          >
            隐藏桌宠
          </button>
        </div>
      )}
      <div className="pet-grip" title="拖动移动桌宠" onMouseDown={startDrag} />

      {hint && !open && <div className="pet-hint">{hint}</div>}

      {widgetOpen && (
        <div className="pet-widget">
          <div className="pet-widget-clock">
            {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="pet-widget-date">
            {now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
          <input
            className="pet-widget-input"
            placeholder="加一条待办，Enter 保存"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const text = event.currentTarget.value.trim();
              if (!text) return;
              setTodos((items) => [...items, { id: Date.now(), text, done: false }]);
              event.currentTarget.value = '';
            }}
          />
          <div className="pet-widget-list">
            {todos.map((todo) => (
              <label key={todo.id} className="pet-widget-item">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() =>
                    setTodos((items) =>
                      items.map((item) =>
                        item.id === todo.id ? { ...item, done: !item.done } : item
                      )
                    )
                  }
                />
                <span className={todo.done ? 'is-done' : ''}>{todo.text}</span>
                <button
                  className="pet-widget-remove"
                  title="删除这条待办"
                  onClick={() => setTodos((items) => items.filter((item) => item.id !== todo.id))}
                >
                  ×
                </button>
              </label>
            ))}
            {!todos.length && <div className="pet-widget-empty">今天还没有待办</div>}
          </div>
        </div>
      )}

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
                className={`mini-btn${widgetOpen ? ' is-active' : ''}`}
                title="桌面小挂件（时钟 / 待办）"
                onClick={() => setWidgetOpen((value) => !value)}
              >
                挂件
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

          <div className="pet-bubble-body" ref={bubbleBody}>
            {history.slice(-4).map((item, index) => (
              <div key={index} className={`pet-line is-${item.role}`}>
                {item.text}
              </div>
            ))}
            {busy && (
              <div className="pet-line is-assistant pet-stream">
                {answer || '思考中…'}
                <button className="mini-btn pet-stop" title="停止生成" onClick={stop}>
                  停止
                </button>
              </div>
            )}
            {error && (
              <div className="pet-line is-error">
                {error}
                <button
                  className="mini-btn"
                  style={{ marginLeft: 6 }}
                  onClick={() => void window.bsub.focusMain()}
                >
                  去主窗口设置 AI
                </button>
              </div>
            )}
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
            <button className="mini-btn" onClick={() => void glance()}>
              看看当前页面
            </button>
            <button className="mini-btn" title="把回答复制到剪贴板" onClick={() => void copyAnswer()}>
              {copied ? '已复制' : '复制'}
            </button>
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
        title="点击聊天，拖动移动，双击打开主窗口"
        onMouseDown={startDrag}
        onClick={() => {
          if (dragStarted.current) {
            dragStarted.current = false;
            return;
          }
          if (soundOn) beep();
          toggleOpen();
        }}
        onDoubleClick={() => void window.bsub.focusMain()}
      >
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        <span className="pet-mouth" />
        {playing && <span className="pet-music">♪</span>}
        {emotion === 'sleeping' && <span className="pet-zzz">z z</span>}
      </button>
    </div>
  );
}
