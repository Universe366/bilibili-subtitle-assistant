import type { PageInfo, QualityIssue, QualityReport, SubtitleLine } from '../shared/types';

export function checkSubtitles(info: PageInfo, lines: SubtitleLine[]): QualityReport {
  const issues: QualityIssue[] = [];
  const duration = Math.max(0, Number(info.duration) || 0);
  const totalChars = lines.reduce((sum, line) => sum + String(line.text || '').length, 0);
  const speechSeconds = lines.reduce(
    (sum, line) => sum + Math.max(0, (Number(line.end) || 0) - (Number(line.start) || 0)),
    0
  );
  const coverage = duration > 0 ? Math.min(1, speechSeconds / duration) : 0;

  if (!lines.length) {
    issues.push({
      code: 'empty',
      severity: 'error',
      message: '没有任何字幕行'
    });
    return {
      issues,
      stats: { lines: 0, duration, coverage: 0, charsPerSecond: 0 }
    };
  }

  let overlapCount = 0;
  let gapCount = 0;
  let duplicateCount = 0;
  let badTimeCount = 0;

  lines.forEach((line, index) => {
    const start = Number(line.start);
    const end = Number(line.end);
    const text = String(line.text || '').trim();

    if (!text) {
      issues.push({
        code: 'empty-line',
        severity: 'warn',
        message: `第 ${index + 1} 行没有文本`,
        lineIndex: index,
        start,
        end
      });
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      badTimeCount += 1;
      if (badTimeCount <= 20) {
        issues.push({
          code: 'bad-time',
          severity: 'error',
          message: `第 ${index + 1} 行时间异常：${start} → ${end}`,
          lineIndex: index,
          start,
          end
        });
      }
      return;
    }
    if (duration > 0 && end > duration * 1.2) {
      issues.push({
        code: 'out-of-range',
        severity: 'warn',
        message: `第 ${index + 1} 行超出视频时长`,
        lineIndex: index,
        start,
        end
      });
    }
    if (text.length > 120) {
      issues.push({
        code: 'long-line',
        severity: 'info',
        message: `第 ${index + 1} 行较长（${text.length} 字）`,
        lineIndex: index,
        start,
        end
      });
    }
    const cps = text.length / Math.max(0.3, end - start);
    if (cps > 12 && /[\u4e00-\u9fff]/.test(text)) {
      issues.push({
        code: 'fast-speech',
        severity: 'warn',
        message: `第 ${index + 1} 行语速偏快（${cps.toFixed(1)} 字/秒）`,
        lineIndex: index,
        start,
        end
      });
    }

    if (index > 0) {
      const previous = lines[index - 1];
      const previousEnd = Number(previous.end) || 0;
      if (start < previousEnd - 0.05) {
        overlapCount += 1;
        if (overlapCount <= 20) {
          issues.push({
            code: 'overlap',
            severity: 'warn',
            message: `第 ${index + 1} 行与上一行重叠 ${(previousEnd - start).toFixed(2)} 秒`,
            lineIndex: index,
            start,
            end
          });
        }
      }
      if (start - previousEnd > 60) {
        gapCount += 1;
        if (gapCount <= 10) {
          issues.push({
            code: 'gap',
            severity: 'info',
            message: `第 ${index} 行到第 ${index + 1} 行之间有 ${Math.round(start - previousEnd)} 秒空白`,
            lineIndex: index + 1,
            start: previousEnd,
            end: start
          });
        }
      }
      if (text && text === String(previous.text || '').trim()) {
        duplicateCount += 1;
        if (duplicateCount <= 10) {
          issues.push({
            code: 'duplicate',
            severity: 'info',
            message: `第 ${index + 1} 行与上一行文本重复`,
            lineIndex: index,
            start,
            end
          });
        }
      }
    }
  });

  const first = lines[0];
  const last = lines[lines.length - 1];
  if ((Number(first.start) || 0) > 30) {
    issues.push({
      code: 'late-start',
      severity: 'warn',
      message: `字幕从 ${Math.round(Number(first.start) || 0)} 秒才开始`,
      lineIndex: 0,
      start: Number(first.start) || 0
    });
  }
  if (duration > 60 && (Number(last.end) || 0) < duration * 0.85) {
    issues.push({
      code: 'early-end',
      severity: 'warn',
      message: `字幕在 ${Math.round(Number(last.end) || 0)} 秒结束，明显早于视频结尾`,
      lineIndex: lines.length - 1,
      start: Number(last.start) || 0,
      end: Number(last.end) || 0
    });
  }
  if (duration > 60 && coverage < 0.35) {
    issues.push({
      code: 'low-coverage',
      severity: 'warn',
      message: `字幕覆盖时长只有 ${(coverage * 100).toFixed(0)}%，可能漏段`
    });
  }

  const severityRank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    issues: issues.slice(0, 200),
    stats: {
      lines: lines.length,
      duration,
      coverage,
      charsPerSecond: speechSeconds > 0 ? totalChars / speechSeconds : 0
    }
  };
}
