import { useState, useEffect } from 'react';
import api from '../../utils/api.js';
import { getLanguageBadgeColor } from '../../utils/fileIcons.js';

export default function RepoSelector({ onSelect }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadRepos();
  }, []);

  async function loadRepos() {
    try {
      const data = await api.get('/api/github/repos');
      setRepos(data.repos || []);
    } catch (err) {
      setError('GitHub token not configured or invalid');
    } finally {
      setLoading(false);
    }
  }

  const filtered = repos.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(search.toLowerCase())
  );

  if (error) {
    return (
      <div className="text-text-muted text-sm bg-bg-surface rounded-lg p-4 text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input"
        placeholder="Search repositories..."
      />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="text-center py-4 text-text-muted text-sm">No repos found</div>
          ) : (
            filtered.map((repo) => (
              <button
                key={repo.fullName}
                onClick={() => onSelect(repo)}
                className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text truncate">{repo.name}</span>
                      {repo.private && (
                        <span className="badge-muted text-xs">Private</span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{repo.description}</p>
                    )}
                  </div>
                  {repo.language && (
                    <span className={`badge text-xs flex-shrink-0 ${getLanguageBadgeColor(repo.language)}`}>
                      {repo.language}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
