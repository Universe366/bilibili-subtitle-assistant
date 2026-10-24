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

/**
 * 桌宠只做「即时」的事：看屏幕、问选中、查资料。
 * 视频总结 / 入库属于主窗口，不在这里重复。
 */
const SELECTION_ACTIONS = [
  {
    id: 'explain',
    label: '解释选中',
    prompt: '解释我选中的这段内容，用通俗的话说清楚，必要时举一个例子。'
  },
  {
    id: 'translate',
    label: '翻译选中',
    prompt: '把我选中的这段内容翻译成中文（若已是中文则译成英文），保留专有名词。'
  }
];

const SHOT_PROMPT = '这张截图里是什么？用 3 条说清楚重点；如果有文字、数字或报错，原样摘出来。';
const OCR_PROMPT = '提取这张图里的所有文字，尽量保留原有的分行和排版；看不清的字用「□」占位。';

const SELF_TALK = [
  '看视频遇到不懂的，右键「看屏幕」就行。',
  '选中网页文字，点「解释选中」就能问。',
  '要查资料就把「联网」打开。',
  '看久了记得起来活动一下。',
  '我在这儿，需要就叫我。'
];

const CLICK_PHRASES = ['摸摸头～', '我在呢！', '有要查的吗？', '别戳啦，会变瘦的'];

/** 与主进程 petGeometry.petLayoutForState 保持一致：气泡 > 菜单 > 挂件 > 紧凑。 */
function layoutForState(open: boolean, widgetOpen: boolean, menuOpen: boolean): PetLayout {
  if (menuOpen) return 'menu';
  if (open) return 'bubble';
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

/** 模型不支持图片时，把底层报错翻译成可照做的提示。 */
function visionHint(raw: string): string {
  const looksLikeImageError =
    /image|vision|multimodal|content type|不支持.{0,6}图片|无效的.{0,4}内容/i.test(raw);
  if (!looksLikeImageError) return raw;
  return '当前 AI 模型可能不支持图片。去「设置 → AI」换一个支持视觉的模型（如 GPT-4o / Claude / Gemini / Qwen-VL）后再试一次。';
}

/** 桌宠窗口：情绪、拖动、气泡对话、截图识图、问选中、联网检索。 */
export function PetWindow() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emotion, setEmotion] = useState<Emotion>('idle');
  const [speak, setSpeak] = useState(() => localStorage.getItem('pet-speak') === '1');
  const [webOn, setWebOn] = useState(() => localStorage.getItem('pet-web') === '1');
  const [hint, setHint] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [playing, setPlaying] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(() => localStorage.getItem('pet-widget') === '1');
  const [now, setNow] = useState(() => new Date());
  const [todos, setTodos] = useState<PetTodo[]>(readTodos);
  const [copied, setCopied] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const [selection, setSelection] = useState<{ text: string; title: string } | null>(null);
  const requestRef = useRef('');
  const withImageRef = useRef(false);
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
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    localStorage.setItem('pet-web', webOn ? '1' : '0');
  }, [webOn]);

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
      setError(withImageRef.current ? visionHint(event.error) : event.error);
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

  const flash = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(''), 2600);
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
    if (!open) setWidgetOpen(false);
    if (!open && Math.random() < 0.4) {
      flash(CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)]);
    }
    setOpen((value) => !value);
  };

  /**
   * 即时问答：默认不抽整页正文（那是主窗口的总结流程），
   * 只有明确附带的截图 / 选中文字才作为上下文。
   */
  const ask = async (text: string, context?: { selection?: string; image?: string }) => {
    const value = text.trim();
    if (!value || busy) return;
    wake();
    setBusy(true);
    setError('');
    setAnswer('');
    setEmotion('thinking');
    setInput('');
    const attachment = context?.image || shot;
    withImageRef.current = Boolean(attachment);

    const quoted = (context?.selection || selection?.text || '').trim().slice(0, 2000);
    const content = quoted
      ? `${value}\n\n我选中的内容：\n"""\n${quoted}\n"""`
      : value;

    setHistory((items) => [
      ...items,
      { role: 'user', text: quoted ? `${value}（含选中内容）` : value }
    ]);
    setSelection(null);
    const requestId = `pet-${Date.now()}`;
    requestRef.current = requestId;
    try {
      const page = await window.bsub.getPageInfo();
      const info = page.ok ? page.data : fallbackInfo();
      const message: ChatMessage = {
        role: 'user',
        content,
        ...(attachment ? { images: [attachment] } : {})
      };
      const started = await window.bsub.chat({
        requestId,
        info,
        lines: [],
        messages: [message],
        // 桌宠只处理即时问题：不把整页正文塞给模型。
        includePage: false,
        web: webOn
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setBusy(false);
      setEmotion('idle');
      const message = (caught as Error).message || '请求失败';
      setError(withImageRef.current ? visionHint(message) : message);
    } finally {
      // 截图只在这一次提问里有效，避免追问时被重复带上。
      if (attachment) setShot(null);
    }
  };

  /** 框选截图：动作条里选「识别图片 / 对话 / 提取文字」。 */
  const takeRegionShot = async () => {
    if (shotBusy || busy) return;
    wake();
    setShotBusy(true);
    try {
      const result = await window.bsub.captureRegion();
      if (!result) return; // 用户取消
      const { action, dataUrl } = result;
      setOpen(true);
      if (action === 'image') {
        // 只把图挂上去，让用户接着问。
        setShot(dataUrl);
        flash('截图已就绪，接着问就行');
        inputRef.current?.focus();
        return;
      }
      setShot(dataUrl);
      await ask(action === 'ocr' ? OCR_PROMPT : SHOT_PROMPT, { image: dataUrl });
    } catch {
      flash('截图失败，请重试');
    } finally {
      setShotBusy(false);
    }
  };

  /** 整页截图：不框选，直接截当前标签页。 */
  const takePageShot = async () => {
    if (shotBusy || busy) return;
    wake();
    setShotBusy(true);
    try {
      const response = await window.bsub.capturePage();
      if (!response.ok) {
        flash(response.error || '截图失败');
        return;
      }
      const dataUrl = response.data.dataUrl;
      setShot(dataUrl);
      setOpen(true);
      await ask(SHOT_PROMPT, { image: dataUrl });
    } finally {
      setShotBusy(false);
    }
  };

  const askSelection = async (prompt: string) => {
    if (busy) return;
    wake();
    const response = await window.bsub.readSelection();
    if (!response.ok) {
      flash(response.error || '读取选中内容失败');
      return;
    }
    const text = response.data.selection.trim();
    if (!text) {
      flash('先在网页里选中一段文字');
      return;
    }
    setSelection({ text, title: response.data.title });
    setOpen(true);
    await ask(prompt, { selection: text });
  };

  const stop = () => {
    if (!requestRef.current) return;
    void window.bsub.cancelChat(requestRef.current);
    setBusy(false);
    setEmotion('idle');
    flash('已停止');
  };

  const togglePlay = async () => {
    const result = await window.bsub.toggleMedia();
    if (result.ok) {
      setPlaying(result.data.playing);
      flash(result.data.playing ? '继续播放' : '已暂停');
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
      flash('复制失败');
    }
  };

  const toggleAlwaysOnTop = async () => {
    const next = await window.bsub.setPetAlwaysOnTop(!alwaysOnTop);
    setAlwaysOnTop(next !== false);
    flash(next !== false ? '已置顶' : '已取消置顶');
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
              void takeRegionShot();
            }}
          >
            <span className="pet-menu-icon">▢</span><span className="pet-menu-label">截图（框选）</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void takePageShot();
            }}
          >
            <span className="pet-menu-icon">▤</span><span className="pet-menu-label">整页截图</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void askSelection(SELECTION_ACTIONS[0].prompt);
            }}
          >
            <span className="pet-menu-icon">◉</span><span className="pet-menu-label">问选中的内容</span>
          </button>
          <span className="pet-menu-sep" />
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.focusMain();
            }}
          >
            <span className="pet-menu-icon">◧</span><span className="pet-menu-label">打开主窗口</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void togglePlay();
            }}
          >
            <span className="pet-menu-icon">{playing ? 'Ⅱ' : '▶'}</span>
            <span className="pet-menu-label">{playing ? '暂停播放' : '继续播放'}</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void toggleAlwaysOnTop();
            }}
          >
            <span className="pet-menu-icon">⇧</span>
            <span className="pet-menu-label">{alwaysOnTop ? '取消置顶' : '窗口置顶'}</span>
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.resetPetPosition();
            }}
          >
            <span className="pet-menu-icon">↺</span><span className="pet-menu-label">重置位置</span>
          </button>
          <span className="pet-menu-sep" />
          <button
            className="is-danger"
            onClick={() => {
              setMenuOpen(false);
              void window.bsub.setPetEnabled(false);
            }}
          >
            <span className="pet-menu-icon">×</span><span className="pet-menu-label">隐藏桌宠</span>
          </button>
        </div>
      )}
      <div className="pet-grip" title="拖动移动桌宠" onMouseDown={startDrag} />

      {hint && <div className="pet-hint">{hint}</div>}

      {widgetOpen && !menuOpen && (
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

      {open && !menuOpen && (
        <div className="pet-bubble">
          <div className="pet-bubble-head">
            <span className="pet-bubble-title">
              <span className={`pet-dot${busy ? ' is-busy' : ''}`} />
              即时助手
            </span>
            <div className="pet-bubble-tools">
              <button
                className={`mini-btn${webOn ? ' is-active' : ''}`}
                title={webOn ? '关闭联网（本轮）' : '打开联网检索'}
                onClick={() => setWebOn((value) => !value)}
              >
                联网
              </button>
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
                onClick={() => {
                  setOpen(false);
                  setWidgetOpen((value) => !value);
                }}
              >
                挂件
              </button>
              <button
                className="pet-close"
                title="隐藏桌宠（可在设置里重新打开）"
                aria-label="隐藏桌宠"
                onClick={() => void window.bsub.setPetEnabled(false)}
              >
                ×
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
                  打开设置
                </button>
              </div>
            )}
            {!history.length && !busy && !error && (
              <div className="pet-empty">
                <span>
                  <b>截图</b> 框选屏幕，识别图片 / 提取文字
                </span>
                <span>
                  <b>选中即问</b> 选中网页文字，一键解释或翻译
                </span>
                <span>
                  <b>联网</b> 打开后回答会带参考链接
                </span>
              </div>
            )}
          </div>

          {(shot || selection) && (
            <div className="pet-attach">
              {shot && (
                <div className="pet-shot">
                  <img src={shot} alt="当前页面截图" />
                  <button title="移除截图" onClick={() => setShot(null)}>
                    ×
                  </button>
                </div>
              )}
              {selection && (
                <div className="pet-selection" title={selection.text}>
                  <span>
                    选中：{selection.text.slice(0, 36)}
                    {selection.text.length > 36 ? '…' : ''}
                  </span>
                  <button title="移除选中内容" onClick={() => setSelection(null)}>
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="pet-quick">
            <button
              className="mini-btn"
              title="框选屏幕区域，再选识别图片 / 对话 / 提取文字"
              disabled={busy || shotBusy}
              onClick={() => void takeRegionShot()}
            >
              {shotBusy ? '截图中…' : '截图'}
            </button>
            {SELECTION_ACTIONS.map((action) => (
              <button
                key={action.id}
                className="mini-btn"
                disabled={busy}
                onClick={() => void askSelection(action.prompt)}
              >
                {action.label}
              </button>
            ))}
            <button className="mini-btn" title="把回答复制到剪贴板" onClick={() => void copyAnswer()}>
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          <div className="pet-bubble-input">
            <input
              ref={inputRef}
              value={input}
              placeholder={webOn ? '问点什么（本轮会联网）' : '问点什么，Enter 发送'}
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
        <span className="pet-glow" />
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        <span className="pet-cheek left" />
        <span className="pet-cheek right" />
        <span className="pet-mouth" />
        {busy && <span className="pet-status" title="正在处理" />}
        {playing && <span className="pet-music">♪</span>}
        {emotion === 'sleeping' && <span className="pet-zzz">z z</span>}
      </button>
    </div>
  );
}
