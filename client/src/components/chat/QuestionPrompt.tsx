import { useState } from 'react';
import type { PendingQuestion } from '../../hooks/useSDKMessages.ts';

interface QuestionPromptProps {
  question: PendingQuestion;
  onRespond: (requestId: string, answers: Record<number, string[]>) => void;
}

export default function QuestionPrompt({ question, onRespond }: QuestionPromptProps) {
  // answers[questionIndex] = array of selected option labels
  const [answers, setAnswers] = useState<Record<number, string[]>>({});

  const allAnswered = question.questions.every((_, idx) => {
    const selected = answers[idx];
    return selected && selected.length > 0;
  });

  function toggleOption(questionIdx: number, label: string, multiSelect: boolean) {
    setAnswers((prev) => {
      const current = prev[questionIdx] || [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [questionIdx]: next };
      }
      // Single select — replace
      return { ...prev, [questionIdx]: [label] };
    });
  }

  function handleSubmit() {
    if (!allAnswered) return;
    onRespond(question.requestId, answers);
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          <span className="text-sm font-medium text-text">Claude has a question</span>
        </div>

        {question.questions.map((q, qIdx) => (
          <div key={qIdx} className={qIdx > 0 ? 'mt-4' : ''}>
            {/* Header chip */}
            {q.header && (
              <span className="inline-block text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-1.5">
                {q.header}
              </span>
            )}

            <p className="text-sm text-text mb-2">{q.question}</p>

            <div className="flex flex-col gap-1.5">
              {q.options.map((opt) => {
                const selected = (answers[qIdx] || []).includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggleOption(qIdx, opt.label, q.multiSelect)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                      selected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/50'
                        : 'border-border bg-bg-surface hover:border-text-dim'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Radio / Checkbox indicator */}
                      <div className="mt-0.5 flex-shrink-0">
                        {q.multiSelect ? (
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                            selected ? 'border-primary bg-primary' : 'border-text-dim'
                          }`}>
                            {selected && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                            selected ? 'border-primary' : 'border-text-dim'
                          }`}>
                            {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <span className={`text-sm font-medium ${selected ? 'text-text' : 'text-text-muted'}`}>
                          {opt.label}
                        </span>
                        {opt.description && (
                          <p className="text-xs text-text-dim mt-0.5 leading-relaxed">{opt.description}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className={`w-full mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            allAnswered
              ? 'bg-primary text-white active:bg-primary-hover'
              : 'bg-bg-surface text-text-dim cursor-not-allowed'
          }`}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
