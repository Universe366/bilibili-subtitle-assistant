import { session } from 'electron';
import type { AiPlatform, AppSettings, AsrPlatform, SearchPlatform } from '../shared/types';
import { isMaskedSecret, loadSettings, testPlatform } from './settings';
import { searchWeb } from './search';
import { listAiModels } from './aiClient';
import { needsApiKey } from './platformKey';

type Kind = 'ai' | 'asr' | 'search';

function savedPlatform(kind: Kind, platform: any): any {
  const settings = loadSettings();
  if (kind === 'ai') {
    return settings.ai.platforms.find((item) => item.id === platform.id);
  }
  if (kind === 'asr') {
    return settings.asr.platforms.find((item) => item.id === platform.id);
  }
  return settings.search.platforms.find((item) => item.id === platform.id);
}

function resolved(kind: Kind, platform: any): any {
  const saved = savedPlatform(kind, platform);
  const apiKey =
    !platform.apiKey || isMaskedSecret(platform.apiKey)
      ? saved?.apiKey || ''
      : platform.apiKey;
  return { ...platform, apiKey };
}

export async function probePlatformModels(
  kind: 'ai' | 'asr',
  platform: AiPlatform | AsrPlatform
): Promise<{ models: string[]; url: string }> {
  const target = resolved(kind, platform);
  if (kind === 'ai') {
    return listAiModels(target as AiPlatform);
  }
  const base = String(target.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('请先填写接口地址');
  if (!target.apiKey && needsApiKey(target)) throw new Error('请先填写 API Key');
  const url = `${base}/models`;
  const response = await session.defaultSession.fetch(url, {
    headers: {
      accept: 'application/json',
      ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {})
    },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型列表 HTTP ${response.status}：${text.slice(0, 160)}`);
  }
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('模型列表不是 JSON');
  }
  const rows = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json?.result)
        ? json.result
        : [];
  const models = rows
    .map((item: any) => String(item?.id || item?.name || item))
    .filter(Boolean);
  return { models, url };
}

export async function testPlatformConnection(
  kind: Kind,
  platform: AiPlatform | AsrPlatform | SearchPlatform
): Promise<{ ok: boolean; ms: number; sample: string }> {
  const started = Date.now();
  if (kind === 'ai') {
    const target = resolved('ai', platform) as AiPlatform;
    const result = await testPlatform(target);
    return {
      ok: true,
      ms: result.latencyMs,
      sample: result.message
    };
  }

  if (kind === 'asr') {
    const target = resolved('asr', platform) as AsrPlatform;
    if (!target.baseUrl.trim()) throw new Error('请先填写接口地址');
    if (!target.apiKey) throw new Error('请先填写 API Key');
    const { models } = await probePlatformModels('asr', target);
    return {
      ok: true,
      ms: Date.now() - started,
      sample: `鉴权通过，平台返回 ${models.length} 个模型`
    };
  }

  const target = resolved('search', platform) as SearchPlatform;
  const settings = loadSettings();
  const copy: AppSettings = {
    ...settings,
    search: {
      ...settings.search,
      enabled: true,
      activeId: target.id,
      platforms: [target]
    }
  };
  if (!target.baseUrl && target.kind !== 'exa') throw new Error('请先填写接口地址');
  const results = await searchWeb(copy, 'B站 字幕');
  return {
    ok: true,
    ms: Date.now() - started,
    sample: `返回 ${results.length} 条结果${results[0]?.title ? `：${results[0].title.slice(0, 50)}` : ''}`
  };
}
