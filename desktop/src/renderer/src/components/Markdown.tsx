import React from 'react';

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${index++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c-${index++}`}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${index++}`}
            href={link[2]}
            onClick={(event) => {
              event.preventDefault();
              void window.bsub.newTab(link[2]);
            }}
          >
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitTableRow(line: string): string[] {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return text.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => (
      <li key={`li-${key}-${index}`}>{inline(item, `li-${key}-${index}`)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`list-${key++}`}>{items}</ol>
      ) : (
        <ul key={`list-${key++}`}>{items}</ul>
      )
    );
    list = null;
  };

  const flushCode = () => {
    if (!code) return;
    blocks.push(
      <pre key={`code-${key++}`}>
        <code>{code.join('\n')}</code>
      </pre>
    );
    code = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();

    if (line.trim().startsWith('```')) {
      if (code) flushCode();
      else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[lineIndex + 1] || '')) {
      flushList();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let cursor = lineIndex + 2;
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        rows.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${key++}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={`th-${index}`}>{inline(cell, `th-${key}-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`td-${rowIndex}-${cellIndex}`}>
                      {inline(row[cellIndex] || '', `td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      lineIndex = cursor - 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const body = inline(heading[2], `h-${key}`);
      const level = heading[1].length;
      if (level === 1) blocks.push(<h1 key={`h-${key++}`}>{body}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${key++}`}>{body}</h2>);
      else if (level === 3) blocks.push(<h3 key={`h-${key++}`}>{body}</h3>);
      else blocks.push(<h4 key={`h-${key++}`}>{body}</h4>);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push(<blockquote key={`quote-${key++}`}>{inline(quote[1], `q-${key}`)}</blockquote>);
      continue;
    }

    if (/^---+$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} />);
      continue;
    }

    flushList();
    blocks.push(<p key={`p-${key++}`}>{inline(line, `p-${key}`)}</p>);
  }

  flushList();
  flushCode();

  return <div className="markdown">{blocks}</div>;
}
