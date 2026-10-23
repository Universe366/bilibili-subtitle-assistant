import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PodcastEpisode, PodcastFeed } from '../shared/types';

/**
 * 播客 / RSS 导入。
 *
 * 只做最小可用的 RSS 2.0 + iTunes 扩展解析：取标题、单集、enclosure 音频地址、
 * 时长和链接。解析失败时给出明确错误，不尝试兼容所有方言。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function tagBlock(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = pattern.exec(block);
  return match ? match[1] : '';
}

function tagText(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const match = pattern.exec(block);
  return match ? decodeEntities(match[1]).replace(/<[^>]+>/g, '').trim() : '';
}

function parseDuration(text: string): number {
  const value = String(text || '').trim();
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(':').map((part) => Number(part) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export async function loadPodcastFeed(input: string): Promise<PodcastFeed> {
  const url = String(input || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('请填写 http(s) 的播客 / RSS 地址');
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml,application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`读取 RSS 失败（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('RSS 文件过大');
  return parsePodcastFeed(text, url);
}

export function parsePodcastFeed(text: string, sourceUrl: string): PodcastFeed {
  if (!/<rss[\s>]/i.test(text) && !/<feed[\s>]/i.test(text)) {
    throw new Error('这个地址不像 RSS / Atom 订阅');
  }

  const channel = tagBlock(text, 'channel') || text;
  const feedTitle = tagText(channel, 'title') || new URL(sourceUrl).hostname;
  const description = tagText(channel, 'description').slice(0, 500);
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  const episodes: PodcastEpisode[] = [];
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(text)) && episodes.length < 60) {
    const block = match[1];
    const enclosure = /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i.exec(block);
    const audioUrl = enclosure ? decodeEntities(enclosure[1]) : '';
    if (!/^https?:\/\//i.test(audioUrl)) continue;
    const title = tagText(block, 'title') || `第 ${episodes.length + 1} 集`;
    const guid = tagText(block, 'guid') || audioUrl;
    const pubDateRaw = tagText(block, 'pubDate');
    const pubDate = pubDateRaw ? Date.parse(pubDateRaw) : NaN;
    episodes.push({
      id: guid.slice(0, 200),
      title: title.slice(0, 200),
      audioUrl,
      pageUrl: tagText(block, 'link') || sourceUrl,
      duration: parseDuration(tagText(block, 'itunes:duration')),
      pubDate: Number.isFinite(pubDate) ? pubDate : null
    });
  }
  if (!episodes.length) throw new Error('RSS 里没有找到可播放的音频单集');
  return { title: feedTitle.slice(0, 200), description, episodes };
}

export async function downloadPodcastAudio(
  audioUrl: string,
  targetDir: string,
  signal?: AbortSignal
): Promise<string> {
  if (!/^https?:\/\//i.test(audioUrl)) throw new Error('音频地址无效');
  fs.mkdirSync(targetDir, { recursive: true });
  const response = await fetch(audioUrl, {
    headers: { 'user-agent': UA },
    signal: signal || AbortSignal.timeout(10 * 60 * 1000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`下载音频失败（HTTP ${response.status}）`);
  }
  const type = String(response.headers.get('content-type') || '');
  const ext = /mpeg|mp3/i.test(type)
    ? 'mp3'
    : /mp4|m4a|aac/i.test(type)
      ? 'm4a'
      : /ogg|opus/i.test(type)
        ? 'ogg'
        : /wav/i.test(type)
          ? 'wav'
          : 'mp3';
  const file = path.join(targetDir, `episode-${Date.now()}.${ext}`);
  await pipeline(
    Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(file)
  );
  return file;
}
