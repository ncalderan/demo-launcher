export interface Step {
  key: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  activeIndex: number;
  onStepClick?: (index: number) => void;
}

/** Horizontal wizard progress indicator. */
export function Stepper({ steps, activeIndex, onStepClick }: StepperProps) {
  return (
    <ol className="stepper">
      {steps.map((step, i) => {
        const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
        return (
          <li key={step.key} className={`stepper-item is-${state}`}>
            <button
              type="button"
              className="stepper-dot"
              disabled={i > activeIndex || !onStepClick}
              onClick={() => onStepClick?.(i)}
            >
              {state === 'done' ? '✓' : i + 1}
            </button>
            <span className="stepper-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
