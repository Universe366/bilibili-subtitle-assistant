import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Send, Square, Trash2 } from 'lucide-react';
import type { ChatMessage, PageInfo, SubtitleLine, TabInfo } from '../../../shared/types';
import { Markdown } from './Markdown';
import { pickTrack, videoKeyOf } from '../lib/video';

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

  const ensureContext = async () => {
    if (contextRef.current) return contextRef.current;
    const infoResponse = await window.bsub.getPageInfo();
    if (!infoResponse.ok) throw new Error(infoResponse.error);
    const info = infoResponse.data;

    const subtitles = await window.bsub.getSubtitles();
    if (!subtitles.ok) throw new Error(subtitles.error);
    const track = pickTrack(subtitles.data.tracks, info);
    if (!track) throw new Error('当前视频没有可用字幕，无法对话');

    const body = await window.bsub.getTrackBody(track.url);
    if (!body.ok) throw new Error(body.error);
    const context = { info, lines: body.data.lines };
    contextRef.current = context;
    return context;
  };

  const send = async (preset?: string) => {
    const content = String(preset ?? input).trim();
    if (!content || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);
    setStreamText('');
    setStatus('读取字幕…');

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);

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
                  message.content
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

      <div className="chat-composer">
        <textarea
          className="chat-input"
          rows={2}
          value={input}
          placeholder={isVideoPage ? '基于本片字幕提问…（Enter 发送）' : '打开 B 站视频后可用'}
          disabled={!isVideoPage}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="mini-btn primary"
          disabled={!isVideoPage || !input.trim() || streaming}
          onClick={() => void send()}
          title="发送"
        >
          <Send size={12} /> 发送
        </button>
      </div>
    </div>
  );
}
