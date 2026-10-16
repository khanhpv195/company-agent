import { BrandMark } from '../../components/ChannelLogo';

/** Illustrated left half of the login screen (original art). */
export function LoginHero() {
  return (
    <div className="hero">
      <svg aria-hidden="true" viewBox="0 0 700 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5d7ea6" />
            <stop offset=".55" stopColor="#b9c6cf" />
            <stop offset="1" stopColor="#e9dcc4" />
          </linearGradient>
          <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fa7bb" />
            <stop offset="1" stopColor="#c9d3d6" />
          </linearGradient>
        </defs>
        <rect width="700" height="900" fill="url(#sky)" />
        <path
          d="M0 470 L120 400 L230 450 L340 380 L470 440 L560 400 L700 450 L700 520 L0 520Z"
          fill="#7d8ea6"
          opacity=".7"
        />
        <rect y="510" width="700" height="120" fill="url(#sea)" />
        <path d="M0 600 H700 V900 H0Z" fill="#e8dcc6" />
        <g fill="#efe5d2" stroke="#d4c4a8" strokeWidth="2">
          <rect x="40" y="250" width="260" height="380" />
          <rect x="300" y="180" width="320" height="450" />
          <rect x="0" y="630" width="700" height="270" />
        </g>
        <path d="M290 180 L460 120 L630 180Z" fill="#b5553a" />
        <g fill="#c9b89a">
          <rect x="80" y="320" width="80" height="100" rx="4" />
          <rect x="350" y="250" width="110" height="120" rx="4" />
          <rect x="490" y="420" width="90" height="140" rx="45" />
          <rect x="60" y="700" width="160" height="120" />
          <rect x="420" y="700" width="200" height="130" />
        </g>
        <g fill="#8a5a3c">
          <rect x="380" y="320" width="50" height="50" />
          <rect x="100" y="760" width="16" height="50" />
          <rect x="470" y="770" width="16" height="50" />
        </g>
        <g fill="#6f7c4a">
          <circle cx="300" cy="170" r="40" />
          <circle cx="270" cy="200" r="30" />
          <circle cx="640" cy="640" r="44" />
          <circle cx="30" cy="640" r="36" />
          <circle cx="250" cy="600" r="26" />
          <ellipse cx="560" cy="880" rx="60" ry="30" />
        </g>
        <g fill="#a95f3c">
          <rect x="280" y="205" width="24" height="26" rx="4" />
          <rect x="236" y="616" width="28" height="30" rx="5" />
        </g>
      </svg>
      <div className="brand">
        <BrandMark size={16} color="#fff" hole={null} />
        Agent
      </div>
    </div>
  );
}
