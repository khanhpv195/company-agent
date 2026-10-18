import { useT } from '../../i18n';
import { useNow } from '../../lib/use-now';
import { scopeKey, typingNames, useChatStore } from '../../stores/chat';

/** "Ana is typing…" above a composer (a fixed-height line, so the layout does not jump). */
export function TypingLine({ roomId, parentId }: { roomId: string; parentId?: string | null }) {
  const t = useT();
  const now = useNow();
  const typing = useChatStore((s) => s.typing);
  const names = typingNames(typing, scopeKey(roomId, parentId), now);
  const text =
    names.length === 0
      ? ''
      : names.length === 1
        ? t('chat.typing.one', { a: names[0]! })
        : names.length === 2
          ? t('chat.typing.two', { a: names[0]!, b: names[1]! })
          : t('chat.typing.many');
  return (
    <div className="typing-line" aria-live="polite">
      {text}
    </div>
  );
}
