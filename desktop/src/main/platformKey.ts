/**
 * 本地模型端点（Ollama / LM Studio / vLLM / llama.cpp server）通常不需要 Key。
 * 之前所有入口都硬性要求 apiKey，导致本地模型根本没法用。
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(String(baseUrl || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

export function needsApiKey(platform: { baseUrl?: string } | null | undefined): boolean {
  if (!platform?.baseUrl) return true;
  return !isLocalEndpoint(platform.baseUrl);
}
