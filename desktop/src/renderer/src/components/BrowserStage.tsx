import { useEffect, useRef } from 'react';
import { MonitorPlay } from 'lucide-react';

export function BrowserStage({ hasTab }: { hasTab: boolean }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const report = () => {
      const rect = element.getBoundingClientRect();
      window.bsub.setLayout({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  return (
    <section ref={ref} className="browser-stage">
      {!hasTab && (
        <div className="stage-empty">
          <div className="stage-empty-icon">
            <MonitorPlay size={26} />
          </div>
          <div className="stage-empty-title">还没有打开的页面</div>
          <div className="stage-empty-desc">
            在地址栏输入 BV 号、链接或搜索词，或者点上面的 + 新建标签页。
          </div>
          <button
            className="primary-btn"
            onClick={() => void window.bsub.newTab('https://www.bilibili.com/')}
          >
            打开 B 站
          </button>
        </div>
      )}
    </section>
  );
}
