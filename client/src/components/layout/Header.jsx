import { useNavigate } from 'react-router-dom';

export default function Header({ title, backTo, actions }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-lg border-b border-border">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          {backTo && (
            <button
              onClick={() => navigate(backTo)}
              className="p-1 -ml-1 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold truncate">{title}</h2>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
