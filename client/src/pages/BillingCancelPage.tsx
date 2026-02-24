import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button.tsx';

export default function BillingCancelPage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <svg className="w-12 h-12 text-text-dim mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-lg font-semibold text-text mb-2">Checkout Cancelled</h2>
        <p className="text-sm text-text-muted mb-4">
          Your checkout was cancelled. No charges were made.
        </p>
        <Button variant="outline" onClick={() => navigate('/settings')}>
          Back to Settings
        </Button>
      </div>
    </div>
  );
}
