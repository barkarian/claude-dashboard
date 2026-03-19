import { cn } from '@/lib/utils';

interface StepperProps {
  steps: string[];
  currentStep: number;
}

export default function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const completed = i < currentStep;
        const active = i === currentStep;

        return (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && (
              <div className={cn(
                'w-8 h-px',
                completed ? 'bg-primary' : 'bg-border'
              )} />
            )}
            <div className="flex items-center gap-1.5">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0',
                completed && 'bg-primary text-white',
                active && 'border-2 border-primary text-primary',
                !completed && !active && 'border border-border text-text-dim'
              )}>
                {completed ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={cn(
                'text-xs whitespace-nowrap',
                active ? 'text-text font-medium' : 'text-text-dim'
              )}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
