import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Send, Square, Trash2, X } from 'lucide-react';
import type {
  ChatMessage,
  PageContextSummary,
  PageInfo,
  SkillItem,
  SubtitleLine,
  TabInfo
} from '../../../shared/types';
import { Markdown } from './Markdown';
import { pickTrack, isVideoKey, videoKeyOf } from '../lib/video';
import { getAsrResult } from '../lib/asrStore';

const SUGGESTIONS = [
  '这个视频的核心观点是什么？',
  '列出视频里提到的数字、结论或方法',
  '有哪些地方值得质疑或需要补充？',
  '用 5 条以内总结这个视频'
];

const PAGE_SUGGESTIONS = [
  '用 5 条要点总结这个页面',
  '这篇内容里有哪些关键数字或结论？',
  '把我选中的内容解释得更通俗',
  '这个页面有哪些值得质疑的地方？'
];

function chatStorageKey(videoKey: string): string {
  return videoKey ? `bsub-chat:${videoKey}` : '';
}

function loadChat(videoKey: string): ChatMessage[] {
  const key = chatStorageKey(videoKey);
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
      .slice(-60);
  } catch {
    return [];
  }
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function ReasoningBlock({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="chat-reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>💭 思考过程</summary>
      <pre>{text}</pre>
    </details>
  );
}

export function ChatPanel({
  activeTab,
  onOpenSettings
}: {
  activeTab: TabInfo | null;
  onOpenSettings: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillId, setSkillId] = useState('');
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [expandReasoning, setExpandReasoning] = useState(false);
  const [pageContext, setPageContext] = useState<PageContextSummary | null>(null);
  const [includePage, setIncludePage] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const autoSaveRef = useRef<{ title: string; url: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef('');
  const contextRef = useRef<{ info: PageInfo; lines: SubtitleLine[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = isVideoKey(videoKey);

  useEffect(() => {
    void (async () => {
      const response = await window.bsub.getSettings();
      if (!response.ok) return;
      const items = response.data.settings.skills.items.filter(
        (item) => item.enabled && item.body.trim()
      );
      setSkills(items);
      setSkillId((current) => (items.some((item) => item.id === current) ? current : ''));
      setSendOnEnter(response.data.settings.ai.sendOnEnter !== false);
      setExpandReasoning(response.data.settings.ai.expandReasoning === true);
    })();
  }, []);

  useEffect(() => {
    if (requestRef.current) {
      void window.bsub.cancelChat(requestRef.current);
      requestRef.current = '';
    }
    contextRef.current = null;
    setMessages(loadChat(videoKey));
    setInput('');
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
    setImages([]);
    setSavedNotice('');
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    const key = chatStorageKey(videoKey);
    if (!key) return;
    try {
      if (messages.length) localStorage.setItem(key, JSON.stringify(messages.slice(-60)));
      else localStorage.removeItem(key);
    } catch {
      // 存储满了也不影响对话
    }
  }, [messages, videoKey]);

  useEffect(() => {
    let alive = true;
    if (!activeTab || !/^https?:/i.test(activeTab.url)) {
      setPageContext(null);
      return;
    }
    void window.bsub.getPageContext().then((response) => {
      if (alive) setPageContext(response.ok ? response.data : null);
    });
    return () => {
      alive = false;
    };
  }, [activeTab?.id, activeTab?.url]);

  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId === requestRef.current) {
        if (event.delta) setStreamText((previous) => previous + event.delta);
      }
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setMessages((previous) => [
        ...previous,
        { role: 'assistant', content: event.text, reasoning: event.reasoning }
      ]);
      setStreaming(false);
      setStreamText('');
      setStatus('');
      requestRef.current = '';

      const pending = autoSaveRef.current;
      autoSaveRef.current = null;
      if (pending && event.text.trim()) {
        void window.bsub
          .savePageSummary({
            title: pending.title,
            url: pending.url,
            content: event.text,
            model: event.model
          })
          .then((response) => {
            if (response.ok) {
              setSavedNotice(
                response.data.created
                  ? '已存入资料库，可在「库」里查看'
                  : '已更新资料库里的网页总结'
              );
            } else {
              setError(`存入资料库失败：${response.error}`);
            }
          });
      }
    });
    const offError = window.bsub.onChatError((event) => {
      if (event.requestId !== requestRef.current) return;
      setError(event.error);
      setStreaming(false);
      setStreamText('');
      setStatus('');
      requestRef.current = '';
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streamText, status]);

  const addImages = async (files: File[]) => {
    const selected = files.filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    let next = [...images];
    for (const file of selected) {
      if (next.length >= 2) {
        setError('最多附带 2 张图片');
        break;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('图片不能超过 5MB');
        continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }).catch(() => '');
      if (data) next = [...next, data];
    }
    setImages(next.slice(0, 2));
  };

  const ensureContext = async () => {
    if (contextRef.current) return contextRef.current;
    const infoResponse = await window.bsub.getPageInfo();
    const info: PageInfo = infoResponse.ok
      ? infoResponse.data
      : {
          kind: 'page',
          bvid: null,
          aid: null,
          cid: null,
          epId: null,
          seasonId: null,
          page: 1,
          partTitle: '',
          parts: [],
          title: activeTab?.title || pageContext?.title || '当前页面',
          owner: '',
          desc: '',
          duration: 0,
          url: activeTab?.url || '',
          signature: ''
        };

    const fallback = (lines: SubtitleLine[] = []) => {
      const cached = getAsrResult(videoKey);
      const context = cached ? { info: cached.info, lines: cached.lines } : { info, lines };
      contextRef.current = context;
      return context;
    };

    // 非视频页只带页面信息，正文由主进程在发送时读取。
    if (!info.bvid && !info.epId) return fallback([]);

    const subtitles = await window.bsub.getSubtitles().catch(() => null);
    if (!subtitles || !subtitles.ok) return fallback([]);
    const track = pickTrack(subtitles.data.tracks, info);

    if (!track) return fallback([]);

    const body = await window.bsub.getTrackBody(track.url);
    if (!body.ok) return fallback([]);
    const context = { info, lines: body.data.lines };
    contextRef.current = context;
    return context;
  };

  const send = async (preset?: string, forcePage = false) => {
    const content = String(preset ?? input).trim();
    if ((!content && !images.length) || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);
    setStreamText('');
    setStatus(isVideoPage ? '读取字幕…' : '读取页面…');

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content, ...(images.length ? { images } : {}) }
    ];
    setMessages(nextMessages);
    setImages([]);

    try {
      const context = await ensureContext();
      setStatus('正在回答…');
      const requestId = newRequestId();
      requestRef.current = requestId;
      const started = await window.bsub.chat({
        requestId,
        info: context.info,
        lines: context.lines,
        messages: nextMessages,
        skillIds: skillId ? [skillId] : [],
        includePage: forcePage ? true : includePage,
        web: webSearch
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setError((caught as Error).message);
      setStreaming(false);
      setStatus('');
      setStreamText('');
    }
  };

  const stop = () => {
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
  };

  const summarizePage = () => {
    if (!activeTab || isVideoPage || streaming) return;
    autoSaveRef.current = { title: activeTab.title || pageContext?.title || activeTab.url, url: activeTab.url };
    setSavedNotice('');
    void send('用 5 条要点总结当前页面，先给结论，再列依据。', true);
  };

  const saveAnswer = async () => {
    if (!activeTab || isVideoPage) return;
    const last = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!last?.content.trim()) return;
    const response = await window.bsub.savePageSummary({
      title: activeTab.title || pageContext?.title || activeTab.url,
      url: activeTab.url,
      content: last.content,
      model: 'AI'
    });
    if (response.ok) {
      setSavedNotice(response.data.created ? '已存入资料库，可在「库」里查看' : '已更新资料库里的网页总结');
    } else {
      setError(`存入资料库失败：${response.error}`);
    }
  };

  // Ctrl+Shift+S：把当前选中内容带进对话。
  useEffect(() => {
    const handler = () => {
      void send('解释我选中的这段内容');
    };
    window.addEventListener('bsub:ask-selection', handler);
    return () => window.removeEventListener('bsub:ask-selection', handler);
  }, [send]);

  // 网页里的划词工具条：解释 / 翻译 / 总结。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; text?: string }>).detail || {};
      const text = String(detail.text || '').trim();
      if (!text) return;
      const clipped = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
      const action = detail.action || 'explain';
      const label =
        action === 'translate'
          ? '翻译成中文（原文是中文就翻译成英文）'
          : action === 'summarize'
            ? '用要点总结'
            : '解释';
      void send(`请${label}下面这段选中的内容：\n"""\n${clipped}\n"""`, true);
    };
    window.addEventListener('bsub:selection-action', handler);
    return () => window.removeEventListener('bsub:selection-action', handler);
  }, [send]);

  // 阅读模式的「AI 总结」。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail || {};
      void send(detail.text || '用 5 条要点总结这个页面，先给结论，再列依据。', true);
    };
    window.addEventListener('bsub:reader-summary', handler);
    return () => window.removeEventListener('bsub:reader-summary', handler);
  }, [send]);

  const clear = () => {
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
    requestRef.current = '';
    const key = chatStorageKey(videoKey);
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    setMessages([]);
    setImages([]);
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
  };

  const showSettingsHint = Boolean(error) && /Key|模型|平台|设置|401|403|404/.test(error || '');

  return (
    <div className="panel chat-panel">
      <div className="panel-toolbar">
        <div className="panel-title">对话</div>
        <div className="toolbar-actions">
          {activeTab && !isVideoPage && (
            <button
              className="mini-btn"
              disabled={streaming}
              title="总结当前网页，并把结果存入本地库"
              onClick={summarizePage}
            >
              总结本页
            </button>
          )}
          {activeTab && !isVideoPage && messages.some((message) => message.role === 'assistant') && (
            <button
              className="mini-btn"
              disabled={streaming}
              title="把最近一条回答存为这个网页的总结"
              onClick={() => void saveAnswer()}
            >
              存入库
            </button>
          )}
          <button
            className="mini-btn"
            disabled={!messages.length && !streaming}
            onClick={clear}
            title="清空对话"
          >
            <Trash2 size={12} /> 清空
          </button>
          {streaming && (
            <button className="mini-btn" onClick={stop} title="停止回答">
              <Square size={11} /> 停止
            </button>
          )}
        </div>
      </div>

      {!activeTab && <div className="panel-empty">打开一个网页或视频后开始对话</div>}

      {activeTab && (
        <div className="chat-body" ref={scrollRef}>
          {!messages.length && !streaming && (
            <div className="chat-empty">
              <div className="chat-empty-title">{isVideoPage ? '基于本片字幕提问' : '就当前页面提问'}</div>
              <div className="chat-empty-desc">
                {isVideoPage
                  ? '会先读取当前视频字幕，再让设置里的 AI 平台回答。'
                  : '会读取当前网页正文和你选中的内容，再让设置里的 AI 平台回答。'}
              </div>
              <div className="chat-suggestions">
                {(isVideoPage ? SUGGESTIONS : PAGE_SUGGESTIONS).map((suggestion) => (
                  <button
                    key={suggestion}
                    className="chat-suggestion"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}-${message.content.slice(0, 16)}`}
              className={`chat-msg ${message.role}`}
            >
              {message.role === 'assistant' && <div className="chat-avatar">AI</div>}
              <div className="chat-bubble">
                {message.role === 'assistant' ? (
                  <>
                    {message.reasoning && (
                      <ReasoningBlock text={message.reasoning} defaultOpen={expandReasoning} />
                    )}
                    <Markdown content={message.content} />
                  </>
                ) : (
                  <>
                    {message.images?.length ? (
                      <div className="chat-images">
                        {message.images.map((src, imageIndex) => (
                          <img
                            key={`${imageIndex}-${src.slice(-12)}`}
                            className="chat-image"
                            src={src}
                            alt=""
                          />
                        ))}
                      </div>
                    ) : null}
                    <div>{message.content}</div>
                  </>
                )}
              </div>
            </div>
          ))}

          {streaming && (
            <div className="chat-msg assistant">
              <div className="chat-avatar">AI</div>
              <div className="chat-bubble">
                {streamText ? (
                  <Markdown content={streamText} />
                ) : (
                  <span className="chat-thinking">
                    <Loader2 size={12} className="spin" /> {status || '正在思考…'}
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="warn-card">
              <AlertTriangle size={15} />
              <div className="warn-body">
                <div className="warn-title">回答失败</div>
                <div className="warn-desc">{error}</div>
                {showSettingsHint && (
                  <button className="warn-btn" onClick={onOpenSettings}>
                    去设置
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {images.length > 0 && (
        <div className="chat-image-preview">
          {images.map((src, index) => (
            <div key={`${index}-${src.slice(-12)}`} className="chat-thumb">
              <img src={src} alt="" />
              <button
                className="chat-thumb-remove"
                title="移除图片"
                onClick={() => setImages(images.filter((_, item) => item !== index))}
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {activeTab && (
        <div className="chat-context-bar">
          <label className="chat-context-chip" title="把当前网页正文一并带给 AI">
            <input
              type="checkbox"
              checked={includePage}
              onChange={(event) => setIncludePage(event.target.checked)}
            />
            当前页面
            {pageContext && pageContext.chars > 0
              ? ` · ${pageContext.chars.toLocaleString('zh-CN')} 字 · 约 ${Math.ceil(
                  pageContext.chars / 1.6
                ).toLocaleString('zh-CN')} tokens`
              : ''}
          </label>
          <label className="chat-context-chip" title="本次对话强制联网检索，回答会列出参考链接">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(event) => setWebSearch(event.target.checked)}
            />
            联网
          </label>
          {pageContext && pageContext.selectionChars > 0 && (
            <span className="chat-context-chip is-selection">
              已选中 {pageContext.selectionChars.toLocaleString('zh-CN')} 字
            </span>
          )}
        </div>
      )}

      {savedNotice && <div className="status-line chat-saved">{savedNotice}</div>}

      <div
        className="chat-composer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addImages(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            void addImages(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
        {skills.length > 0 && (
          <select
            className="chat-skill-select"
            title="选择本轮使用的技能"
            value={skillId}
            disabled={streaming}
            onChange={(event) => setSkillId(event.target.value)}
          >
            <option value="">✨ 技能</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.icon || '✨'} {skill.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="icon-btn"
          title="添加图片（也可粘贴/拖入）"
          disabled={!activeTab || streaming || images.length >= 2}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus size={14} />
        </button>
        <textarea
          className="chat-input"
          rows={2}
          value={input}
          placeholder={
            activeTab
              ? `就当前页面提问…（${sendOnEnter ? 'Enter' : 'Ctrl+Enter'} 发送）`
              : '打开网页后可用'
          }
          disabled={!activeTab}
          onChange={(event) => setInput(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || []);
            if (files.some((file) => file.type.startsWith('image/'))) {
              event.preventDefault();
              void addImages(files);
            }
          }}
          onKeyDown={(event) => {
            const enterSends = sendOnEnter
              ? event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey
              : event.key === 'Enter' && (event.ctrlKey || event.metaKey);
            if (enterSends) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="mini-btn primary"
          disabled={!activeTab || (!input.trim() && !images.length) || streaming}
          onClick={() => void send()}
          title="发送"
        >
          <Send size={12} /> 发送
        </button>
      </div>
    </div>
  );
}
