/**
 * The Crafillio DevKit mark.
 *
 * A shell prompt turned into a monogram: an angle bracket `<` and a blinking
 * cursor bar sit inside a rounded tile, with a stray "dot" that reads as both a
 * terminal caret and the dot of a semicolon. Drawn from scratch as plain paths
 * so it ships as code — no image asset, no font dependency, and it scales and
 * recolours with the theme.
 */

interface Props {
  size?: number;
  /** Animates the cursor. Off inside dense UI like the title bar. */
  animated?: boolean;
  title?: string;
}

export function Logo({ size = 28, animated = false, title = 'Crafillio DevKit' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="ck-tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#e4007f" />
          <stop offset="55%" stopColor="#b5008f" />
          <stop offset="100%" stopColor="#6a3fd6" />
        </linearGradient>
        <linearGradient id="ck-shine" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Tile */}
      <rect width="48" height="48" rx="12" fill="url(#ck-tile)" />
      <rect width="48" height="48" rx="12" fill="url(#ck-shine)" />

      {/* Prompt chevron */}
      <path
        d="M13 17.5 L20.5 24 L13 30.5"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />

      {/* Cursor bar */}
      <rect x="24.5" y="27.6" width="12" height="3.4" rx="1.7" fill="#ffffff" opacity="0.92">
        {animated && (
          <animate
            attributeName="opacity"
            values="0.92;0.92;0.15;0.15;0.92"
            dur="1.6s"
            repeatCount="indefinite"
          />
        )}
      </rect>

      {/* Caret dot — the "semicolon" flourish */}
      <circle cx="30.6" cy="18.4" r="2.5" fill="#ffffff" opacity="0.92" />
    </svg>
  );
}

/** Wordmark used on the About screen. */
export function Wordmark({ size = 40 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Logo size={size} animated />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: size * 0.46, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Crafillio <span style={{ color: 'var(--accent)' }}>DevKit</span>
        </div>
        <div style={{ fontSize: size * 0.28, color: 'var(--text-dim)' }}>
          REST · gRPC · S3 · Load testing
        </div>
      </div>
    </div>
  );
}
