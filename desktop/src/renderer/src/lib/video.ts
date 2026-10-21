import type { PageInfo, SubtitleTrack } from '../../../shared/types';

// B 站是单页应用，?vd_source / ?spm_id_from 这类 query 变化不应触发重新抓取。
// 只按「视频 + 分 P」生成 key。
export function videoKeyOf(url?: string): string {
  if (!url || url === 'about:blank') return '';
  try {
    const parsed = new URL(url);
    if (!/(^|\.)bilibili\.com$/i.test(parsed.hostname)) return `u:${parsed.href}`;
    const bv = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/i);
    const ep = parsed.pathname.match(/\/bangumi\/play\/(ep\d+)/i);
    const p = parsed.searchParams.get('p') || '1';
    if (bv) return `v:${bv[1]}:p${p}`;
    if (ep) return `e:${ep[1]}`;
    return `u:${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function pickTrack(tracks: SubtitleTrack[], info: PageInfo | null): SubtitleTrack | null {
  if (!tracks.length) return null;
  const cid = info?.cid ? String(info.cid) : '';
  const aid = info?.aid ? String(info.aid) : '';

  const score = (track: SubtitleTrack) => {
    let value = 0;
    // 带当前 aid/cid 的 URL 可以确定属于这个视频；B 站预取/切页会留下过期轨
    if (cid && track.url.includes(cid)) value += 50;
    if (aid && track.url.includes(aid)) value += 25;
    if (/^zh/i.test(track.lan)) value += 4;
    if (/^ai-zh/i.test(track.lan)) value += 2;
    if (track.isAi) value += 1;
    return value;
  };

  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}
