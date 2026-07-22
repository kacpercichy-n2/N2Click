// Okrągły przycisk z wyłącznie ikoną (SVG). Istnieje po to, by raz na zawsze
// zabić powracający problem źle wycentrowanych glifów tekstowych (× / +): ikona
// jest flex-centrowana w kwadratowym polu i NIGDY nie polega na line-height ani
// baseline czcionki. Etykieta dostępności (`label`) trafia do aria-label, a
// `title` domyślnie ją powtarza. Wariant `danger` odwzorowuje `.btn.danger-ghost`.
import type { ReactNode } from 'react';

interface Props {
  label: string; // aria-label (obowiązkowy — przycisk ikonowy nie ma tekstu)
  title?: string; // tooltip; domyślnie = label
  onClick: () => void;
  icon: ReactNode;
  variant?: 'default' | 'danger';
  className?: string;
  size?: number; // rozmiar kwadratu w px (domyślnie ze stylu .icon-btn)
}

export function IconButton({
  label,
  title,
  onClick,
  icon,
  variant = 'default',
  className,
  size,
}: Props) {
  const cls = ['icon-btn', variant === 'danger' ? 'danger' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      style={size != null ? { width: size, height: size } : undefined}
    >
      {icon}
    </button>
  );
}
