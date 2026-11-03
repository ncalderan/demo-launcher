import type { IconSpec } from '../domain/types';

/** Relative luminance (0-1) of a hex color, to decide if it needs a light backdrop to read on a dark badge. */
function luminance(hex: string): number {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Below this, a brand mark (e.g. Splunk's near-black `#000000`) is unreadable on our dark badge backgrounds. */
const LIGHT_BACKDROP_THRESHOLD = 0.12;

/**
 * A source or destination's visual icon. Real vendor logos (`brand-svg`/
 * `brand-image`) render at their own brand color — normal practice for a
 * third-party integration mark, and distinct from Cribl's own single-color
 * icon convention. Entries with no confirmed-available real logo (`generic`)
 * get a shared neutral glyph in the app's own accent color instead of a
 * guessed/invented logo. Very dark brand marks (e.g. Splunk's black) get a
 * light backdrop of their own so they stay legible on our dark badges.
 */
export function SourceIcon({ icon, size = 22 }: { icon: IconSpec; size?: number }) {
  if (icon.kind === 'brand-svg') {
    const needsLightBackdrop = luminance(icon.hex) < LIGHT_BACKDROP_THRESHOLD;
    return (
      <span
        className={`source-icon source-icon-brand${needsLightBackdrop ? ' source-icon-needs-backdrop' : ''}`}
        style={{ width: size, height: size, color: `#${icon.hex}` }}
        // eslint-disable-next-line react/no-danger -- trusted, build-time-only SVG from our own registry (simple-icons / a vetted downloaded brand asset), not user input.
        dangerouslySetInnerHTML={{ __html: icon.svg }}
        aria-label={icon.label}
        role="img"
      />
    );
  }
  if (icon.kind === 'brand-image') {
    return (
      <span className="source-icon source-icon-brand-image" style={{ width: size, height: size }}>
        <img src={icon.src} alt={icon.label} width={size} height={size} />
      </span>
    );
  }
  return (
    <span className="source-icon source-icon-generic" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="6.5" cy="7" r="0.9" fill="currentColor" />
        <circle cx="6.5" cy="17" r="0.9" fill="currentColor" />
      </svg>
    </span>
  );
}
