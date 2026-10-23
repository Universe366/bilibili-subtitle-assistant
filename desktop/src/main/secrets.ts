import { safeStorage } from 'electron';

/**
 * API Key / Token 在磁盘上的封装。
 *
 * - 内存里始终是明文，只有落盘那一刻才加密；
 * - 用 Windows DPAPI（safeStorage）加密，换机器/换用户无法解密；
 * - 带上 `enc:v1:` 前缀，便于识别老版本留下的明文并自动迁移；
 * - 系统不支持加密时（少数 Linux 桌面没有 keyring）退回明文，但不能因此丢 Key。
 */
const PREFIX = 'enc:v1:';

export function isSealedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function sealSecret(value: string): string {
  const text = String(value || '');
  if (!text || isSealedSecret(text)) return text;
  try {
    if (!safeStorage.isEncryptionAvailable()) return text;
    return `${PREFIX}${safeStorage.encryptString(text).toString('base64')}`;
  } catch (error) {
    console.warn('[secrets] 加密失败，保留明文:', (error as Error).message);
    return text;
  }
}

export function openSecret(value: string): string {
  const text = String(value || '');
  if (!isSealedSecret(text)) return text;
  try {
    return safeStorage.decryptString(Buffer.from(text.slice(PREFIX.length), 'base64'));
  } catch (error) {
    // 解密失败说明换了系统账户或 DPAPI 数据损坏：宁可让用户重填，也不要回传密文。
    console.warn('[secrets] 解密失败，需要重新填写 Key:', (error as Error).message);
    return '';
  }
}
