import { useState, useEffect, type FormEvent } from 'react';
import { useAIGenerate } from '../../hooks/useAIGenerate.ts';
import api from '../../utils/api.ts';

interface AIScriptGeneratorProps {
  projectId: string;
  onClose: () => void;
  onScriptsAdded: () => void;
}

interface GeneratedScript {
  label: string;
  command: string;
  autostart: boolean;
  selected: boolean;
}

export default function AIScriptGenerator({ projectId, onClose, onScriptsAdded }: AIScriptGeneratorProps) {
  const [mode, setMode] = useState<'choose' | 'auto-detect' | 'describe'>('choose');
  const [description, setDescription] = useState('');
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [adding, setAdding] = useState(false);

  const { isGenerating, status, step, partialText, result, error, generateScripts, cancel, reset } = useAIGenerate();

  // When result arrives, populate scripts
  useEffect(() => {
    if (result && Array.isArray(result)) {
      setScripts(result.map((s: any) => ({
        label: s.label || '',
        command: s.command || '',
        autostart: s.autostart || false,
        selected: true,
      })));
    }
  }, [result]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (isGenerating) cancel();
    };
  }, [isGenerating, cancel]);

  function handleAutoDetect() {
    setMode('auto-detect');
    generateScripts(projectId, 'auto-detect');
  }

  function handleDescribe(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setMode('describe');
    generateScripts(projectId, 'describe', description.trim());
  }

  function toggleScript(index: number) {
    setScripts(prev => prev.map((s, i) => i === index ? { ...s, selected: !s.selected } : s));
  }

  async function handleAddSelected() {
    const selected = scripts.filter(s => s.selected);
    if (selected.length === 0) return;

    setAdding(true);
    try {
      for (const s of selected) {
        await api.post(`/api/projects/${projectId}/scripts`, {
          label: s.label,
          command: s.command,
          autostart: s.autostart,
        });
      }
      onScriptsAdded();
    } catch (err) {
      console.error('Failed to add scripts:', err);
    } finally {
      setAdding(false);
    }
  }

  function handleClose() {
    if (isGenerating) cancel();
    reset();
    onClose();
  }

  function handleRetry() {
    reset();
    setScripts([]);
    setMode('choose');
  }

  const selectedCount = scripts.filter(s => s.selected).length;

  // ─── Mode Chooser ─────────────────────────────────────
  if (mode === 'choose') {
    return (
      <div className="card border-primary/30 bg-gradient-to-br from-bg-surface to-primary/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text">Generate with AI</h3>
              <p className="text-xs text-text-muted">Let AI analyze your project and suggest scripts</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1 rounded hover:bg-bg-hover text-text-dim hover:text-text transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Auto-detect option */}
        <button
          onClick={handleAutoDetect}
          className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-all mb-2 text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text">Auto-detect</div>
            <div className="text-xs text-text-muted">Scan your project and suggest the most important scripts</div>
          </div>
          <svg className="w-4 h-4 text-text-dim flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Describe option */}
        <form onSubmit={handleDescribe} className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-primary/40 transition-all">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what scripts you need..."
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim min-w-0"
          />
          <button
            type="submit"
            disabled={!description.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-40 flex-shrink-0"
          >
            Generate
          </button>
        </form>
      </div>
    );
  }

  // ─── Generating / Results ─────────────────────────────
  return (
    <div className="card border-primary/30 bg-gradient-to-br from-bg-surface to-primary/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-text">
            {isGenerating ? 'Analyzing Project' : error ? 'Generation Failed' : 'Suggested Scripts'}
          </h3>
        </div>
        <button onClick={handleClose} className="p-1 rounded hover:bg-bg-hover text-text-dim hover:text-text transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Loading state with animated steps */}
      {isGenerating && (
        <div className="space-y-3">
          {/* Animated analysis visualization */}
          <div className="relative overflow-hidden rounded-lg bg-bg/80 border border-border/50 p-4">
            {/* Shimmer effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" />

            <div className="relative flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full border-2 border-primary/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                  </svg>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full animate-pulse" />
              </div>

              <div className="flex-1">
                <div className="text-sm font-medium text-text mb-0.5">
                  {status === 'analyzing' && 'Analyzing project...'}
                  {status === 'reading' && 'Reading files...'}
                  {status === 'generating' && 'Generating scripts...'}
                </div>
                <div className="text-xs text-text-muted">{step}</div>
              </div>
            </div>

            {/* Progress dots */}
            <div className="flex gap-1 mt-3">
              <div className={`h-1 rounded-full transition-all duration-500 ${
                status === 'analyzing' || status === 'reading' || status === 'generating'
                  ? 'bg-primary flex-1' : 'bg-border flex-1'
              }`} />
              <div className={`h-1 rounded-full transition-all duration-500 ${
                status === 'reading' || status === 'generating'
                  ? 'bg-primary flex-1' : 'bg-border flex-1'
              }`} />
              <div className={`h-1 rounded-full transition-all duration-500 ${
                status === 'generating' ? 'bg-primary flex-1' : 'bg-border flex-1'
              }`} />
            </div>
          </div>

          <button
            onClick={() => cancel()}
            className="w-full btn-ghost text-xs text-text-dim"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error state */}
      {error && !isGenerating && (
        <div className="space-y-3">
          <div className="text-sm text-danger bg-danger/10 px-3 py-2 rounded-lg">{error}</div>
          <div className="flex gap-2">
            <button onClick={handleRetry} className="btn-outline flex-1 text-sm">Try Again</button>
            <button onClick={handleClose} className="btn-ghost flex-1 text-sm">Close</button>
          </div>
        </div>
      )}

      {/* Results */}
      {!isGenerating && !error && scripts.length > 0 && (
        <div className="space-y-2">
          {scripts.map((script, i) => (
            <button
              key={i}
              onClick={() => toggleScript(i)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left ${
                script.selected
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/50 bg-bg/50 opacity-60'
              }`}
            >
              {/* Checkbox */}
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                script.selected ? 'bg-primary border-primary' : 'border-border'
              }`}>
                {script.selected && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{script.label}</span>
                  {script.autostart && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">autostart</span>
                  )}
                </div>
                <div className="text-xs text-text-dim font-mono mt-0.5 truncate">{script.command}</div>
              </div>
            </button>
          ))}

          <div className="flex gap-2 pt-1">
            <button onClick={handleRetry} className="btn-ghost flex-1 text-sm">Regenerate</button>
            <button
              onClick={handleAddSelected}
              disabled={selectedCount === 0 || adding}
              className="btn-primary flex-1 text-sm disabled:opacity-50"
            >
              {adding
                ? 'Adding...'
                : `Add ${selectedCount} Script${selectedCount !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
