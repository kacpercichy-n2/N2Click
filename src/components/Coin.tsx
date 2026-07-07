// Paid / unpaid coin marker: gold = paid, bronze = unpaid. Shown on project
// cards across every view; optionally clickable to toggle (project detail).

interface Props {
  paid: boolean;
  size?: number;
  onToggle?: () => void; // when set, renders as a button
}

function CoinSvg({ paid, size }: { paid: boolean; size: number }) {
  // Brightened for dark surfaces so paid (yellow-gold) reads clearly distinct
  // from unpaid (copper-bronze) even at 12-16px. A soft glow is added in CSS.
  const [light, mid, dark] = paid
    ? ['#fff0b0', '#f5b93a', '#c98a1e'] // gold
    : ['#e8c6a0', '#c67e42', '#8a5220']; // bronze
  const gradId = paid ? 'coin-gold' : 'coin-bronze';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={light} />
          <stop offset="60%" stopColor={mid} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      <circle cx="10" cy="10" r="9" fill={`url(#${gradId})`} stroke={dark} />
      <circle cx="10" cy="10" r="6.2" fill="none" stroke={dark} strokeOpacity="0.45" />
      <text
        x="10"
        y="13.4"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill={dark}
      >
        z
      </text>
    </svg>
  );
}

export function Coin({ paid, size = 18, onToggle }: Props) {
  const label = paid ? 'Projekt opłacony' : 'Projekt nieopłacony';
  if (onToggle) {
    return (
      <button
        type="button"
        className="coin-btn"
        onClick={onToggle}
        title={`${label} — kliknij, aby oznaczyć jako ${paid ? 'nieopłacony' : 'opłacony'}`}
        aria-label={`${label} — przełącz`}
      >
        <CoinSvg paid={paid} size={size} />
      </button>
    );
  }
  return (
    <span className="coin" title={label} role="img" aria-label={label}>
      <CoinSvg paid={paid} size={size} />
    </span>
  );
}
