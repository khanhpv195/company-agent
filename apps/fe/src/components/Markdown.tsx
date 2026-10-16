import { Fragment, type ReactNode } from 'react';
import { usePeople } from '../features/workspace/workspace.api';

/**
 * Small markdown subset used by chat and tasks: paragraphs, numbered/bulleted lists,
 * fenced code, `code`, **bold** and @mentions. Renders React elements (no HTML injection).
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function inline(text: string, names: string[], key: string): ReactNode[] {
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

function blocks(src: string, names: string[]): ReactNode[] {
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
      while (i < lines.length && lines[i].trim() && !/^(\d+\. |- |```)/.test(lines[i])) {
        if (parts.length) parts.push(<br key={`br${i}`} />);
        parts.push(...inline(lines[i], names, `p${i}`));
        i++;
      }
      out.push(<p key={key}>{parts}</p>);
    } else i++;
  }
  return out;
}

export function Markdown({ text, children }: { text: string; children?: ReactNode }) {
  const { mentionNames } = usePeople();
  return (
    <>
      {blocks(text, mentionNames)}
      {children}
    </>
  );
}

/** One line of inline markdown (bold, code, mentions). */
export function Inline({ text }: { text: string }) {
  const { mentionNames } = usePeople();
  return <>{inline(text, mentionNames, 'i')}</>;
}
