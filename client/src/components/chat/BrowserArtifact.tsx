/**
 * BrowserArtifact — placeholder card emitted when the agent calls
 * `mcp__claw_browser__display_browser_session`. Phase 2 deliverable: a
 * static "browser session started" card so the user knows the agent is
 * driving a browser. Phase 3 will replace the body with a live screencast
 * canvas + Pause / Take Over / Resume controls.
 */

import type { ChatBrowserSession } from '../../../../shared/types/models.ts';

interface BrowserArtifactProps {
  session: ChatBrowserSession;
}

export default function BrowserArtifact({ session }: BrowserArtifactProps) {
  const isClosed = session.status === 'closed';
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm flex items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${isClosed ? 'bg-text-muted' : 'bg-green-500'}`}
        aria-hidden
      />
      <span className="font-medium">{session.label || 'Browser session'}</span>
      <span className="text-text-muted text-xs">
        {isClosed ? 'closed' : 'agent driving — live view coming in next release'}
      </span>
    </div>
  );
}
