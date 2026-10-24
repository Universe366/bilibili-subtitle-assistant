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

/** 桌宠窗口：点击展开气泡对话，拖拽移动（CSS app-region）。 */
export function PetWindow() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef('');

  useEffect(() => {
    const offDelta = window.bsub.onChatDelta((event) => {
      if (event.requestId !== requestRef.current) return;
      setAnswer((previous) => previous + event.delta);
    });
    const offDone = window.bsub.onChatDone((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      setAnswer(event.text);
    });
    const offError = window.bsub.onChatError((event) => {
      if (event.requestId !== requestRef.current) return;
      setBusy(false);
      setError(event.error);
    });
    return () => {
      offDelta();
      offDone();
      offError();
    };
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setAnswer('');
    setInput('');
    const requestId = `pet-${Date.now()}`;
    requestRef.current = requestId;
    try {
      const page = await window.bsub.getPageInfo();
      const info = page.ok ? page.data : fallbackInfo();
      const messages: ChatMessage[] = [{ role: 'user', content: text }];
      const started = await window.bsub.chat({
        requestId,
        info,
        lines: [],
        messages,
        includePage: false
      });
      if (!started.ok) throw new Error(started.error);
    } catch (caught) {
      setBusy(false);
      setError((caught as Error).message);
    }
  };

  return (
    <div className={`pet-root${open ? ' is-open' : ''}`}>
      <div className="pet-grip" title="拖动移动桌宠" />
      {open && (
        <div className="pet-bubble">
          <div className="pet-bubble-title">拾字助手</div>
          <div className="pet-bubble-body">
            {error ? <span className="pet-error">{error}</span> : answer || (busy ? '思考中…' : '问我点什么吧')}
          </div>
          <div className="pet-bubble-input">
            <input
              value={input}
              placeholder="输入问题，Enter 发送"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send();
                if (event.key === 'Escape') setOpen(false);
              }}
            />
            <button className="mini-btn primary" disabled={busy || !input.trim()} onClick={() => void send()}>
              发送
            </button>
          </div>
        </div>
      )}
      <button
        className={`pet-body${busy ? ' is-busy' : ''}`}
        title="点击和桌宠聊天"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        <span className="pet-mouth" />
      </button>
    </div>
  );
}
