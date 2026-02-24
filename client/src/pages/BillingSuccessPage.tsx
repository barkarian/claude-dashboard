import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import api from '../utils/api.ts';

export default function BillingSuccessPage() {
  const navigate = useNavigate();
  const { refreshPlan } = useAuth();
  const [step, setStep] = useState<'confirming' | 'provisioning' | 'done' | 'timeout'>('confirming');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startFlow();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startFlow() {
    // Refresh plan to pick up the pro upgrade
    await refreshPlan();
    setStep('provisioning');

    // Poll VPS status until running or timeout (5 min)
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.get<{ vpsInstance: { status: string } | null }>('/api/billing/vps-status');
        if (data.vpsInstance?.status === 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          setStep('done');
          setTimeout(() => navigate('/settings'), 2000);
        }
      } catch { /* continue polling */ }

      if (Date.now() - startRef.current > 5 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStep('timeout');
      }
    }, 8000);
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {step === 'confirming' && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-text mb-2">Payment Confirmed</h2>
            <p className="text-sm text-text-muted">Activating your Pro plan...</p>
          </>
        )}

        {step === 'provisioning' && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-text mb-2">Setting up your VPS...</h2>
            <p className="text-sm text-text-muted">
              This usually takes 2-3 minutes. Please don't close this page.
            </p>
          </>
        )}

        {step === 'done' && (
          <>
            <svg className="w-12 h-12 text-success mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-lg font-semibold text-text mb-2">You're on Pro!</h2>
            <p className="text-sm text-text-muted">Redirecting to settings...</p>
          </>
        )}

        {step === 'timeout' && (
          <>
            <svg className="w-12 h-12 text-warning mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h2 className="text-lg font-semibold text-text mb-2">VPS still setting up</h2>
            <p className="text-sm text-text-muted mb-4">
              Your VPS is taking longer than expected. It will be ready soon — you can check back on the Settings page.
            </p>
            <button
              onClick={() => navigate('/settings')}
              className="text-sm text-primary hover:underline"
            >
              Go to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
