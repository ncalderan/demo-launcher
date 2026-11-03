import type { ReactNode } from 'react';

interface OptionCardProps {
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  badge?: string;
  meta?: ReactNode;
  /** Leading visual anchor (e.g. a vendor logo via `SourceIcon`), shown in a badge. */
  icon?: ReactNode;
}

/** Selectable card used throughout the wizard for single/multi choices. */
export function OptionCard({
  title,
  description,
  selected,
  onClick,
  badge,
  meta,
  icon,
}: OptionCardProps) {
  return (
    <button
      type="button"
      className={`option-card${selected ? ' is-selected' : ''}${icon ? ' has-icon' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      {icon && <span className="option-card-icon">{icon}</span>}
      <span className="option-card-body">
        <span className="option-card-head">
          <span className="option-card-title">{title}</span>
          {badge && <span className="option-card-badge">{badge}</span>}
        </span>
        {description && <span className="option-card-desc">{description}</span>}
        {meta && <span className="option-card-meta">{meta}</span>}
      </span>
    </button>
  );
}
