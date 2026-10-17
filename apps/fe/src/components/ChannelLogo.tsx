/** Simplified channel marks (placeholders, not official artwork). */
export function ChannelLogo({ id, size }: { id: string; size: number }) {
  const s = { width: size, height: size };
  if (id === 'zalo')
    return (
      <span className="lg" style={s}>
        <svg viewBox="0 0 48 48" aria-label="Zalo">
          <rect width="48" height="48" rx="12" fill="#0068ff" />
          <path
            d="M13 13h22a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H23l-8 5v-5h-2a5 5 0 0 1-5-5V18a5 5 0 0 1 5-5z"
            fill="#fff"
          />
          <text
            x="24"
            y="27"
            textAnchor="middle"
            fontFamily="Inter,Arial,sans-serif"
            fontWeight="700"
            fontSize="9.5"
            fill="#0068ff"
          >
            Zalo
          </text>
        </svg>
      </span>
    );
  if (id === 'facebook')
    return (
      <span className="lg" style={s}>
        <svg viewBox="0 0 48 48" aria-label="Facebook">
          <rect width="48" height="48" rx="12" fill="#1877f2" />
          <path
            d="M26.6 39V26.4h4.2l.6-4.9h-4.8v-3.1c0-1.4.4-2.4 2.4-2.4h2.6v-4.4c-.4-.1-2-.2-3.8-.2-3.7 0-6.3 2.3-6.3 6.5v3.6h-4.2v4.9h4.2V39z"
            fill="#fff"
          />
        </svg>
      </span>
    );
  if (id === 'gmail')
    return (
      <span className="lg" style={s}>
        <svg viewBox="0 0 48 48" aria-label="Gmail">
          <rect x=".5" y=".5" width="47" height="47" rx="11.5" fill="#fff" stroke="#e6e6e6" />
          <path
            d="M11 17.5V34h5.5V22.6L24 28.2l7.5-5.6V34H37V17.5L34 15l-10 7.5L14 15z"
            fill="#ea4335"
          />
          <path d="M11 17.5V34h5.5V22.6z" fill="#4285f4" />
          <path d="M31.5 22.6V34H37V17.5z" fill="#34a853" />
          <path d="M37 17.5 34 15l-2.5 1.9v5.7z" fill="#fbbc04" />
          <path d="M11 17.5l3-2.5 2.5 1.9v5.7z" fill="#c5221f" />
        </svg>
      </span>
    );
  return null;
}

export function LetterLogo({
  bg,
  fg,
  text,
  size,
}: {
  bg: string;
  fg: string;
  text: string;
  size: number;
}) {
  return (
    <span className="lg" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill={bg} />
        <text
          x="24"
          y="31"
          textAnchor="middle"
          fontFamily="Inter,Arial,sans-serif"
          fontWeight="700"
          fontSize={text.length > 1 ? 15 : 20}
          fill={fg}
        >
          {text}
        </text>
      </svg>
    </span>
  );
}

export const BrandMark = ({
  size = 22,
  color = 'var(--brand)',
  hole = 'var(--rail)',
}: {
  size?: number;
  color?: string;
  hole?: string | null;
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <g style={{ fill: color }}>
      <ellipse cx="12" cy="6" rx="3.2" ry="5" />
      <ellipse cx="12" cy="18" rx="3.2" ry="5" />
      <ellipse cx="6" cy="12" rx="5" ry="3.2" />
      <ellipse cx="18" cy="12" rx="5" ry="3.2" />
    </g>
    {hole && <circle cx="12" cy="12" r="2.2" style={{ fill: hole }} />}
  </svg>
);
