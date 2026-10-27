export interface Step {
  key: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  activeIndex: number;
  onStepClick?: (index: number) => void;
}

/**
 * In-page section jump-nav. All sections are visible at once (no wizard
 * gating), so every entry is always clickable — `activeIndex` just highlights
 * whichever section is currently in view (scroll-spy), driven by the caller.
 */
export function Stepper({ steps, activeIndex, onStepClick }: StepperProps) {
  return (
    <ol className="stepper">
      {steps.map((step, i) => (
        <li key={step.key} className={`stepper-item${i === activeIndex ? ' is-active' : ''}`}>
          <button type="button" className="stepper-dot" onClick={() => onStepClick?.(i)}>
            {i + 1}
          </button>
          <span className="stepper-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
