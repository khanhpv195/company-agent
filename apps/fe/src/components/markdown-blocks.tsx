import { Fragment, type ReactNode } from 'react';

/**
 * Pure markdown-subset parser used by chat and tasks: paragraphs, numbered/bulleted
 * lists, fenced code, GFM tables, `code`, **bold** and @mentions. Produces React
 * elements only (no HTML injection), so cell and paragraph text is escaped by React.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function inline(text: string, names: string[], key: string): ReactNode[] {
  const mention = names.length ? `|@(?:${names.map(escapeRe).join('|')})` : '';
  const re = new RegExp(`(\`[^\`]+\`|\\*\\*[^*]+\\*\\*${mention})`, 'g');
  return text.split(re).map((part, i) => {
    const k = `${key}-${i}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1)
      return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3)
      return <b key={k}>{part.slice(2, -2)}</b>;
    if (part.startsWith('@') && names.includes(part.slice(1)))
      return (
        <span key={k} className="mention">
          {part}
        </span>
      );
    return <Fragment key={k}>{part}</Fragment>;
  });
}

/** Delimiter row such as `| --- | :-: | ---: |` (pipes at the ends are optional). */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Split a table row on unescaped `|`, honouring `\|` and optional outer pipes. */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && s[j + 1] === '|') {
      cur += '|';
      j++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

type Align = 'left' | 'center' | 'right' | undefined;

/** A GFM table starts with a row containing `|`, followed by a delimiter row with the same column count. */
export function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length) return false;
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (!header.includes('|') || !DELIMITER_ROW.test(delimiter) || !delimiter.includes('-')) {
    return false;
  }
  return splitTableRow(header).length === splitTableRow(delimiter).length;
}

function alignments(delimiter: string): Align[] {
  return splitTableRow(delimiter).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return undefined;
  });
}

function table(lines: string[], start: number, names: string[], key: string) {
  const header = splitTableRow(lines[start]);
  const aligns = alignments(lines[start + 1]);
  const width = header.length;
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    const cells = splitTableRow(lines[i]).slice(0, width);
    while (cells.length < width) cells.push('');
    rows.push(cells);
    i++;
  }
  const cellStyle = (j: number) => (aligns[j] ? { textAlign: aligns[j] } : undefined);
  const node = (
    <div key={key} className="md-table-wrap">
      <table>
        <thead>
          <tr>
            {header.map((cell, j) => (
              <th key={j} style={cellStyle(j)}>
                {inline(cell, names, `${key}h${j}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, j) => (
                <td key={j} style={cellStyle(j)}>
                  {inline(cell, names, `${key}r${r}c${j}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return { node, next: i };
}

const HEADING = /^(#{1,6}) +(\S.*)$/;

/**
 * `headings` (skill preview only) renders `# Title` lines as small headings (h3-h6) and ends
 * a paragraph at them; chat keeps `#` as plain text.
 */
export function blocks(src: string, names: string[], headings = false): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
    } else if (headings && HEADING.test(line)) {
      const [, hashes, title] = HEADING.exec(line)!;
      const Tag = `h${Math.min(hashes.length + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
      out.push(<Tag key={key}>{inline(title.trim(), names, `h${i}`)}</Tag>);
      i++;
    } else if (isTableStart(lines, i)) {
      const t = table(lines, i, names, key);
      out.push(t.node);
      i = t.next;
    } else if (/^\d+\. /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\d+\. /, ''), names, `l${i}`)}</li>);
        i++;
      }
      out.push(<ol key={key}>{items}</ol>);
    } else if (/^- /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].slice(2), names, `l${i}`)}</li>);
        i++;
      }
      out.push(<ul key={key}>{items}</ul>);
    } else if (line.trim()) {
      const parts: ReactNode[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(\d+\. |- |```)/.test(lines[i]) &&
        !(headings && HEADING.test(lines[i])) &&
        !isTableStart(lines, i)
      ) {
        if (parts.length) parts.push(<br key={`br${i}`} />);
        parts.push(...inline(lines[i], names, `p${i}`));
        i++;
      }
      out.push(<p key={key}>{parts}</p>);
    } else i++;
  }
  return out;
}
