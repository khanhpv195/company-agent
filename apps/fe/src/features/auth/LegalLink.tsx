import { onExternalLinkClick } from '../../lib/open-external';

/** A link to a public legal page, or plain text when the page URL is not configured. */
export function LegalLink({ url, children }: { url: string | null; children: string }) {
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => onExternalLinkClick(e, url)}
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}
