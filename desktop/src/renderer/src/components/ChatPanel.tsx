import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Send, Square, Trash2, X } from 'lucide-react';
import type { ChatMessage, PageInfo, SubtitleLine, TabInfo } from '../../../shared/types';
import { Markdown } from './Markdown';
import { pickTrack, videoKeyOf } from '../lib/video';
import { getAsrResult } from '../lib/asrStore';

const SUGGESTIONS = [
  '这个视频的核心观点是什么？',
  '列出视频里提到的数字、结论或方法',
  '有哪些地方值得质疑或需要补充？',
  '用 5 条以内总结这个视频'
];

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef('');
  const contextRef = useRef<{ info: PageInfo; lines: SubtitleLine[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const videoKey = videoKeyOf(activeTab?.url);
  const isVideoPage = videoKey.startsWith('v:') || videoKey.startsWith('e:');

  useEffect(() => {
    if (requestRef.current) {
      void window.bsub.cancelChat(requestRef.current);
      requestRef.current = '';
    }
    contextRef.current = null;
    setMessages([]);
    setInput('');
    setStreamText('');
    setStatus('');
    setError(null);
    setStreaming(false);
    setImages([]);
  }, [activeTab?.id, videoKey]);

  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId === requestRef.current) {
        setStreamText((previous) => previous + event.delta);
      }
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setMessages((previous) => [...previous, { role: 'assistant', content: event.text }]);
      setStreaming(false);
      setStreamText('');
      setStatus('');
      requestRef.current = '';
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
    if (!infoResponse.ok) throw new Error(infoResponse.error);
    const info = infoResponse.data;

    const subtitles = await window.bsub.getSubtitles();
    if (!subtitles.ok) throw new Error(subtitles.error);
    const track = pickTrack(subtitles.data.tracks, info);
    const fallback = () => {
      const cached = getAsrResult(videoKey);
      if (!cached) return null;
      const context = { info: cached.info, lines: cached.lines };
      contextRef.current = context;
      return context;
    };

    if (!track) {
      const cached = fallback();
      if (cached) return cached;
      throw new Error('当前视频没有可用字幕，无法对话');
    }

    const body = await window.bsub.getTrackBody(track.url);
    if (!body.ok) {
      const cached = fallback();
      if (cached) return cached;
      throw new Error(body.error);
    }
    const context = { info, lines: body.data.lines };
    contextRef.current = context;
    return context;
  };

  const send = async (preset?: string) => {
    const content = String(preset ?? input).trim();
    if ((!content && !images.length) || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);
    setStreamText('');
    setStatus('读取字幕…');

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
        messages: nextMessages
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

  const clear = () => {
    if (requestRef.current) void window.bsub.cancelChat(requestRef.current);
    requestRef.current = '';
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

      {!activeTab && <div className="panel-empty">打开一个 B 站视频后开始对话</div>}
      {activeTab && !isVideoPage && <div className="panel-empty">当前页面不是 B 站视频页</div>}

      {isVideoPage && (
        <div className="chat-body" ref={scrollRef}>
          {!messages.length && !streaming && (
            <div className="chat-empty">
              <div className="chat-empty-title">基于本片字幕提问</div>
              <div className="chat-empty-desc">
                会先读取当前视频字幕，再让设置里的 AI 平台回答。
              </div>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((suggestion) => (
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
                  <Markdown content={message.content} />
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
        <button
          className="icon-btn"
          title="添加图片（也可粘贴/拖入）"
          disabled={!isVideoPage || streaming || images.length >= 2}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImagePlus size={14} />
        </button>
        <textarea
          className="chat-input"
          rows={2}
          value={input}
          placeholder={isVideoPage ? '基于本片字幕提问…（Enter 发送）' : '打开 B 站视频后可用'}
          disabled={!isVideoPage}
          onChange={(event) => setInput(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || []);
            if (files.some((file) => file.type.startsWith('image/'))) {
              event.preventDefault();
              void addImages(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="mini-btn primary"
          disabled={!isVideoPage || (!input.trim() && !images.length) || streaming}
          onClick={() => void send()}
          title="发送"
        >
          <Send size={12} /> 发送
        </button>
      </div>
    </div>
  );
}
