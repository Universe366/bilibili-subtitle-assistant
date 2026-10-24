/** 批量导出时给重名文件加序号：报告.md → 报告-2.md */
export function uniqueFileName(used: Set<string>, base: string, ext: string): string {
  const safeBase = base.trim() || '未命名';
  let candidate = `${safeBase}.${ext}`;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${safeBase}-${index}.${ext}`;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** 去掉 Windows 不允许的文件名字符，并限制长度。 */
export function safeFileBase(name: string, maxLength = 60): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength) || '未命名'
  );
}
