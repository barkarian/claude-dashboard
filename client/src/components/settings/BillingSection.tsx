import { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import api from '../../utils/api.ts';

export default function BillingSection() {
  const { user, isVps, refreshPlan } = useAuth();
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [downgraded, setDowngraded] = useState(false);
  const [vpsReady, setVpsReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get<{ stripeEnabled: boolean }>('/api/billing/config')
      .then((data) => setStripeEnabled(data.stripeEnabled))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Poll VPS status when local + pro (detect when VPS comes up)
  useEffect(() => {
    if (isVps || user?.plan !== 'pro') return;

    function pollVps() {
      api.get<{ vpsInstance: { status: string } | null }>('/api/billing/vps-status')
        .then((data) => {
          if (data.vpsInstance?.status === 'running') {
            setVpsReady(true);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        })
        .catch(() => {});
    }

    pollVps();
    pollRef.current = setInterval(pollVps, 8000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isVps, user?.plan]);

  async function handleUpgrade() {
    setActionLoading(true);
    try {
      if (stripeEnabled) {
        const data = await api.post<{ url: string }>('/api/billing/create-checkout');
        window.location.href = data.url;
      } else {
        await api.post('/api/billing/dev-upgrade');
        await refreshPlan();
      }
    } catch (err) {
      console.error('Upgrade failed:', err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDowngrade() {
    setActionLoading(true);
    try {
      if (stripeEnabled) {
        const data = await api.post<{ url: string }>('/api/billing/customer-portal');
        window.location.href = data.url;
      } else {
        await api.post('/api/billing/dev-downgrade');
        if (isVps) {
          // On VPS: show static shutdown message, don't make further API calls
          setDowngraded(true);
        } else {
          await refreshPlan();
        }
        setShowConfirm(false);
      }
    } catch (err) {
      console.error('Downgrade failed:', err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManageBilling() {
    setActionLoading(true);
    try {
      const data = await api.post<{ url: string }>('/api/billing/customer-portal');
      window.location.href = data.url;
    } catch (err) {
      console.error('Failed to open billing portal:', err);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-border rounded w-32" />
          <div className="h-4 bg-border rounded w-48" />
        </div>
      </div>
    );
  }

  const isPro = user?.plan === 'pro';

  // VPS + downgraded: static shutdown message
  if (isVps && downgraded) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
          Plan & Billing
        </h3>
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
          <p className="text-sm text-text font-medium mb-1">You've been downgraded to Free</p>
          <p className="text-sm text-text-muted">
            This VPS will shut down shortly. Start your local dashboard to continue using the service.
          </p>
        </div>
      </div>
    );
  }

  // VPS + free (shouldn't normally happen, but handle gracefully)
  if (isVps && !isPro) {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
          </svg>
          Plan & Billing
        </h3>
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
          <p className="text-sm text-text-muted">
            This VPS will shut down shortly. Run your local dashboard to continue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-text mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
        Plan & Billing
      </h3>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-text-muted">Current plan:</span>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          isPro ? 'bg-primary/15 text-primary' : 'bg-border text-text-dim'
        }`}>
          {isPro ? 'PRO' : 'FREE'}
        </span>
      </div>

      {isPro ? (
        <div className="space-y-3">
          {/* Banner when VPS becomes ready on local */}
          {!isVps && vpsReady && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-text font-medium">Your VPS is running! Your dashboard is now accessible from anywhere.</p>
              </div>
            </div>
          )}
          <p className="text-sm text-text-muted">
            You're on the Pro plan with a dedicated VPS, SSH access, and persistent URLs.
          </p>
          <div className="flex items-center gap-2">
            {stripeEnabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleManageBilling}
                disabled={actionLoading}
              >
                {actionLoading ? 'Loading...' : 'Manage Billing'}
              </Button>
            )}
            {!stripeEnabled && (
              <>
                {showConfirm ? (
                  <div className="space-y-2">
                    {isVps && (
                      <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
                        <p className="text-sm text-danger font-medium">
                          Downgrading will destroy this VPS. To continue using the dashboard after downgrading, you'll need to run it locally on your machine.
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {!isVps && (
                        <span className="text-sm text-danger">Downgrade? Your VPS will be destroyed.</span>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleDowngrade}
                        disabled={actionLoading}
                      >
                        {actionLoading ? 'Downgrading...' : 'Confirm'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowConfirm(false)}
                        disabled={actionLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConfirm(true)}
                  >
                    Downgrade to Free
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="text-sm text-text-muted space-y-1.5">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Dedicated VPS instance
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              SSH access to your server
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Always-on dashboard
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Persistent public URL
            </li>
          </ul>
          <Button
            onClick={handleUpgrade}
            disabled={actionLoading}
          >
            {actionLoading ? 'Processing...' : 'Upgrade to Pro'}
          </Button>
        </div>
      )}
    </div>
  );
}
