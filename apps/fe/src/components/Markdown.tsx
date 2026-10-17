import type { ReactNode } from 'react';
import { usePeople } from '../features/workspace/workspace.api';
import { blocks, inline } from './markdown-blocks';

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
