/**
 * The API Devkit mark.
 *
 * A cog carrying "API" at the centre of a small network — the gear is the
 * request being configured, the satellites are the endpoints it talks to.
 *
 * Drawn as flat vector shapes in `currentColor`, so it inherits the
 * surrounding text colour and works on any surface in either theme. The gear
 * is a single compound path whose inner circle is counter-wound, so
 * `fill-rule: evenodd` punches a genuine hole rather than painting one in a
 * background colour that would break the moment the theme changed.
 */

interface Props {
  size?: number;
  /** Kept for call-site compatibility; the mark is deliberately static. */
  animated?: boolean;
  title?: string;
}

/** Satellite endpoints and the connectors that reach them. */
const NODES = [
  { cx: 5.9, cy: 13.88, r: 3.6, x1: 15.17, y1: 18.81, x2: 8.6, y2: 15.32 },
  { cx: 4.5, cy: 23.5, r: 3.3, x1: 14.0, y1: 23.5, x2: 7.3, y2: 23.5 },
  { cx: 9.14, cy: 36.88, r: 3.4, x1: 16.57, y1: 30.19, x2: 11.29, y2: 34.95 },
  { cx: 42.1, cy: 13.88, r: 3.6, x1: 32.83, y1: 18.81, x2: 39.4, y2: 15.32 },
  { cx: 38.86, cy: 36.88, r: 3.4, x1: 31.43, y1: 30.19, x2: 36.71, y2: 34.95 },
];

const GEAR =
  'M 21.24 14.52 L 21.51 12.37 A 11.4 11.4 0 0 1 26.49 12.37 L 26.76 14.52 ' +
  'A 9.4 9.4 0 0 1 28.40 15.19 L 30.11 13.87 A 11.4 11.4 0 0 1 33.63 17.39 ' +
  'L 32.31 19.10 A 9.4 9.4 0 0 1 32.98 20.74 L 35.13 21.01 A 11.4 11.4 0 0 1 ' +
  '35.13 25.99 L 32.98 26.26 A 9.4 9.4 0 0 1 32.31 27.90 L 33.63 29.61 ' +
  'A 11.4 11.4 0 0 1 30.11 33.13 L 28.40 31.81 A 9.4 9.4 0 0 1 26.76 32.48 ' +
  'L 26.49 34.63 A 11.4 11.4 0 0 1 21.51 34.63 L 21.24 32.48 A 9.4 9.4 0 0 1 ' +
  '19.60 31.81 L 17.89 33.13 A 11.4 11.4 0 0 1 14.37 29.61 L 15.69 27.90 ' +
  'A 9.4 9.4 0 0 1 15.02 26.26 L 12.87 25.99 A 11.4 11.4 0 0 1 12.87 21.01 ' +
  'L 15.02 20.74 A 9.4 9.4 0 0 1 15.69 19.10 L 14.37 17.39 A 11.4 11.4 0 0 1 ' +
  '17.89 13.87 L 19.60 15.19 A 9.4 9.4 0 0 1 21.24 14.52 Z ' +
  'M 30.9 23.5 A 6.9 6.9 0 1 0 17.1 23.5 A 6.9 6.9 0 1 0 30.9 23.5 Z';

/**
 * Below this the satellites crowd the cog into an indistinct blob and the
 * lettering stops resolving, so small sizes crop to the gear alone — which
 * fills the same box and keeps "API" readable.
 */
const COMPACT_BELOW = 30;

export function Logo({ size = 28, title = 'API Devkit' }: Props) {
  const compact = size < COMPACT_BELOW;

  return (
    <svg
      width={size}
      height={size}
      // Cropping to the gear's bounding box is what makes the compact form
      // fill its box rather than shrinking inside the full-network artwork.
      viewBox={compact ? '11.8 11.3 24.4 24.4' : '0 0 48 48'}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <path d={GEAR} fillRule="evenodd" clipRule="evenodd" />

      {!compact &&
        NODES.map((node, index) => (
          <g key={index}>
            <line
              x1={node.x1}
              y1={node.y1}
              x2={node.x2}
              y2={node.y2}
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
            />
            <circle cx={node.cx} cy={node.cy} r={node.r} />
          </g>
        ))}

      <text
        x="24"
        y="23.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-display), system-ui, sans-serif"
        fontSize="6.6"
        fontWeight="700"
        letterSpacing="-0.2"
      >
        API
      </text>
    </svg>
  );
}

/** Wordmark used on the About screen. */
export function Wordmark({ size = 40 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Logo size={size} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: size * 0.46, fontWeight: 700, letterSpacing: '-0.02em' }}>
          API <span style={{ color: 'var(--accent)' }}>Devkit</span>
        </div>
        <div style={{ fontSize: size * 0.28, color: 'var(--text-dim)' }}>
          REST · gRPC · S3 · Workflows · Load testing
        </div>
      </div>
    </div>
  );
}
