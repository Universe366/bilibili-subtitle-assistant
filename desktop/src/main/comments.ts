import { session } from 'electron';
import type { PageInfo } from '../shared/types';

export interface HotComment {
  author: string;
  content: string;
  like: number;
}

function stripHtml(value: string): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchHotComments(info: PageInfo, limit = 12): Promise<HotComment[]> {
  const aid = Number(info.aid || 0);
  if (!aid) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('评论请求超时')), 15000);
  try {
    const url =
      `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&ps=${Math.max(
        1,
        Math.min(20, limit)
      )}&pn=1`;
    const response = await session.defaultSession.fetch(url, {
      headers: {
        Referer: 'https://www.bilibili.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`评论接口 HTTP ${response.status}`);
    const data: any = await response.json();
    if (Number(data?.code) !== 0) throw new Error(data?.message || '评论接口返回错误');
    const replies = Array.isArray(data?.data?.replies) ? data.data.replies : [];
    return replies
      .map((reply: any) => ({
        author: stripHtml(reply?.member?.uname || '匿名'),
        content: stripHtml(reply?.content?.message || ''),
        like: Number(reply?.like || 0)
      }))
      .filter((item: HotComment) => item.content.length >= 2)
      .slice(0, Math.max(1, Math.min(20, limit)));
  } finally {
    clearTimeout(timer);
  }
}
