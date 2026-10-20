// 版本号比较（仅用于本扩展的 1.2.3 形式）。
//
// 规则：去掉前缀 v、忽略 -beta / +build 后缀；逐段按数字比较，缺位补 0。
// 不用字符串比较 —— "1.63.10" > "1.63.9" 只有按数字比才成立。

export function normalizeVersion(v) {
  return String(v == null ? '' : v)
    .trim()
    .replace(/^v/i, '')
    .split(/[-+]/)[0]
    .trim();
}

export function versionParts(v) {
  return normalizeVersion(v)
    .split('.')
    .map((x) => Math.max(0, parseInt(x, 10) || 0));
}

export function compareVersions(a, b) {
  const A = versionParts(a);
  const B = versionParts(b);
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i += 1) {
    const x = A[i] || 0;
    const y = B[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0;
}
