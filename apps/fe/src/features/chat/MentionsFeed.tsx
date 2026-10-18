import { Link } from '@tanstack/react-router';
import { useT } from '../../i18n';
import { short } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { usePeople } from '../workspace/workspace.api';
import { useMentionsFeed } from './chat.api';

const firstLine = (markdown: string) => markdown.replace(/\*\*|`/g, '').split('\n')[0] ?? '';

/** The "@me" view: messages that mention the caller, newest first. */
export function MentionsFeed() {
  const t = useT();
  const people = usePeople();
  const now = useNow();
  const query = useMentionsFeed(true);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isPending) return <div className="empty-line">{t('chat.loading')}</div>;
  if (query.isError) return <div className="err-line">{query.error.message}</div>;
  if (!items.length) return <div className="empty-line">{t('chat.noMentions')}</div>;
  return (
    <>
      {items.map((it) => {
        const a = it.message.author;
        const who = a.kind === 'external' ? a.name : people.name(a.id);
        return (
          <Link
            key={it.message.id}
            to="/chat/$roomId"
            params={{ roomId: it.roomId }}
            search={{
              thread: it.threadRootId ?? undefined,
              message: it.message.id,
            }}
            className="item mention-item"
          >
            <div className="meta">
              <div className="row">
                <span className="name">{who}</span>
                <span className="time">{short(it.message.createdAt, now)}</span>
              </div>
              <div className="sub-line">
                {it.roomKind === 'dm' ? t('chat.dm') : `#${it.roomName}`}
                {it.threadTitle && ` › ${it.threadTitle}`}
              </div>
              <div className="prev">{firstLine(it.message.markdown)}</div>
            </div>
          </Link>
        );
      })}
      {query.hasNextPage && (
        <button
          type="button"
          className="btn sm load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('chat.loadMore')}
        </button>
      )}
    </>
  );
}
