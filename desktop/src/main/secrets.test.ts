import { beforeEach, describe, expect, it, vi } from 'vitest';

const decryptShouldFail = { value: false };

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`sealed:${text}`),
    decryptString: (buffer: Buffer) => {
      if (decryptShouldFail.value) throw new Error('DPAPI unavailable');
      const raw = buffer.toString();
      if (!raw.startsWith('sealed:')) throw new Error('bad payload');
      return raw.slice('sealed:'.length);
    }
  }
}));

import { isSealedSecret, openSecret, sealSecret } from './secrets';

describe('secrets', () => {
  beforeEach(() => {
    decryptShouldFail.value = false;
  });

  it('加密后带 enc:v1: 前缀，内存里可还原', () => {
    const sealed = sealSecret('sk-test-123456');
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('sk-test-123456');
    expect(isSealedSecret(sealed)).toBe(true);
    expect(openSecret(sealed)).toBe('sk-test-123456');
  });

  it('重复加密不会套娃', () => {
    const once = sealSecret('token');
    expect(sealSecret(once)).toBe(once);
  });

  it('旧版本明文原样返回，方便自动迁移', () => {
    expect(openSecret('plain-key')).toBe('plain-key');
    expect(isSealedSecret('plain-key')).toBe(false);
  });

  it('空值不加密', () => {
    expect(sealSecret('')).toBe('');
    expect(openSecret('')).toBe('');
  });

  it('解密失败时返回空串，而不是把密文当 Key', () => {
    decryptShouldFail.value = true;
    expect(openSecret(sealSecret('broken'))).toBe('');
  });
});
