import type { ReactNode } from 'react';
import { usePeople } from '../features/workspace/workspace.api';
import { blocks, inline } from './markdown-blocks';

/** `headings` (skill preview) turns `#` lines into headings and skips @mention chips. */
export function Markdown({
  text,
  headings = false,
  children,
}: {
  text: string;
  headings?: boolean;
  children?: ReactNode;
}) {
  const { mentionNames } = usePeople();
  return (
    <>
      {blocks(text, headings ? [] : mentionNames, headings)}
      {children}
    </>
  );
}

/** One line of inline markdown (bold, code, mentions). */
export function Inline({ text }: { text: string }) {
  const { mentionNames } = usePeople();
  return <>{inline(text, mentionNames, 'i')}</>;
}
