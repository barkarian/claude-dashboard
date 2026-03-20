import { useState } from 'react';
import { haptics } from '../../utils/haptics.ts';
import type { PendingQuestion } from '../../hooks/useSDKMessages.ts';

interface QuestionPromptProps {
  question: PendingQuestion;
  onRespond: (requestId: string, answers: Record<number, string[]>) => void;
  onDismiss: (requestId: string) => void;
}

export default function QuestionPrompt({ question, onRespond, onDismiss }: QuestionPromptProps) {
  const totalQuestions = question.questions.length;
  // Steps: 0..totalQuestions-1 = question steps, totalQuestions = review step
  const totalSteps = totalQuestions + 1;

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});

  const isReviewStep = step === totalQuestions;
  const currentQuestion = !isReviewStep ? question.questions[step] : null;

  const currentSelected = answers[step] || [];
  const currentCustom = customInputs[step] || '';
  const hasAnswer = currentSelected.length > 0 || currentCustom.trim().length > 0;

  function toggleOption(label: string, multiSelect: boolean) {
    haptics.impactLight();
    setAnswers((prev) => {
      const current = prev[step] || [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [step]: next };
      }
      // Single select — replace, also clear custom input
      setCustomInputs((ci) => ({ ...ci, [step]: '' }));
      return { ...prev, [step]: [label] };
    });
  }

  function handleCustomChange(value: string) {
    setCustomInputs((prev) => ({ ...prev, [step]: value }));
    // For single-select, using custom input clears option selection
    if (currentQuestion && !currentQuestion.multiSelect && value.trim()) {
      setAnswers((prev) => ({ ...prev, [step]: [] }));
    }
  }

  function goNext() {
    if (!hasAnswer || isReviewStep) return;
    haptics.impactLight();
    setStep((s) => s + 1);
  }

  function goBack() {
    if (step === 0) return;
    haptics.impactLight();
    setStep((s) => s - 1);
  }

  function buildFinalAnswers(): Record<number, string[]> {
    const final: Record<number, string[]> = {};
    for (let i = 0; i < totalQuestions; i++) {
      const selected = answers[i] || [];
      const custom = (customInputs[i] || '').trim();
      if (custom) {
        final[i] = [...selected, custom];
      } else {
        final[i] = selected;
      }
    }
    return final;
  }

  function getStepSummary(idx: number): string {
    const selected = answers[idx] || [];
    const custom = (customInputs[idx] || '').trim();
    const parts = [...selected];
    if (custom) parts.push(custom);
    return parts.join(', ') || 'Not answered';
  }

  function handleSubmit() {
    haptics.notificationSuccess();
    onRespond(question.requestId, buildFinalAnswers());
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-primary/40 bg-primary/5 overflow-hidden">
      <div className="px-4 py-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
          <span className="text-sm font-medium text-text">Claude has a question</span>
        </div>

        {/* Stepper indicator */}
        <div className="flex items-center gap-1 mb-4 px-1">
          {Array.from({ length: totalSteps }).map((_, i) => {
            const isActive = i === step;
            const isCompleted = i < step;
            const isReview = i === totalQuestions;
            return (
              <div key={i} className="flex items-center gap-1 flex-1">
                <button
                  onClick={() => {
                    // Allow navigating to completed steps or review if all answered
                    if (isCompleted || (isReview && i <= step)) setStep(i);
                  }}
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-primary text-white scale-110'
                      : isCompleted
                        ? 'bg-primary/20 text-primary cursor-pointer'
                        : 'bg-bg-surface text-text-dim'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : isReview ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </button>
                {i < totalSteps - 1 && (
                  <div className={`flex-1 h-0.5 rounded-full transition-colors ${
                    isCompleted ? 'bg-primary/30' : 'bg-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        {isReviewStep ? (
          /* ---- Review step ---- */
          <div>
            <p className="text-sm font-medium text-text mb-3">Review your answers</p>
            <div className="flex flex-col gap-2 mb-3">
              {question.questions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => setStep(idx)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border bg-bg-surface hover:border-text-dim transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      {q.header && (
                        <span className="inline-block text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full mb-0.5">
                          {q.header}
                        </span>
                      )}
                      <p className="text-xs text-text-dim truncate">{q.question}</p>
                    </div>
                    <span className="text-xs font-medium text-text flex-shrink-0 max-w-[45%] text-right truncate">
                      {getStepSummary(idx)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : currentQuestion ? (
          /* ---- Question step ---- */
          <div>
            {/* Header chip */}
            {currentQuestion.header && (
              <span className="inline-block text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-1.5">
                {currentQuestion.header}
              </span>
            )}

            <p className="text-sm text-text mb-2.5">{currentQuestion.question}</p>

            {/* Options */}
            <div className="flex flex-col gap-1.5">
              {currentQuestion.options.map((opt) => {
                const selected = currentSelected.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggleOption(opt.label, currentQuestion.multiSelect)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                      selected
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/50'
                        : 'border-border bg-bg-surface hover:border-text-dim'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Radio / Checkbox indicator */}
                      <div className="mt-0.5 flex-shrink-0">
                        {currentQuestion.multiSelect ? (
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

            {/* Custom input */}
            <div className="mt-2.5">
              <input
                type="text"
                value={currentCustom}
                onChange={(e) => handleCustomChange(e.target.value)}
                placeholder="Or type your own answer..."
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg-surface text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>
        ) : null}

        {/* Navigation buttons */}
        <div className="flex gap-2 mt-3">
          {step > 0 && (
            <button
              onClick={goBack}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-bg-surface text-sm text-text-muted hover:text-text hover:border-text-dim transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
          )}

          <div className="flex-1" />

          {isReviewStep ? (
            <button
              onClick={handleSubmit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium active:bg-primary-hover transition-colors"
            >
              Submit
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!hasAnswer}
              className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                hasAnswer
                  ? 'bg-primary text-white active:bg-primary-hover'
                  : 'bg-bg-surface text-text-dim cursor-not-allowed'
              }`}
            >
              Next
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}
        </div>

        {/* Divider + Chat about it */}
        <div className="mt-3 pt-3 border-t border-primary/20">
          <button
            onClick={() => onDismiss(question.requestId)}
            className="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-text-muted hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Chat about these questions instead
          </button>
        </div>
      </div>
    </div>
  );
}
