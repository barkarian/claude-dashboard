/**
 * Provider catalog — what shows up as cards in the Catalog page.
 *
 * A "provider" groups one or more adapters under a single brand (e.g. Claude
 * groups Claude Agent + Claude Code; OpenCode is a single-adapter provider).
 * Each provider gets one card; clicking Configure opens a dialog that walks
 * through auth + each adapter's install / default model / favorites.
 *
 * Adding a new provider is a data-only change here — the UI reads this list
 * directly and the configure dialog handles the rest.
 */

export type ProviderId = 'claude' | 'opencode' | 'cursor';

export interface ProviderAdapter {
  /** Adapter id (matches the registered adapter from adapters/<id>/manifest.ts) */
  id: string;
  /** Sub-label inside the configure dialog (e.g. "Agent", "Code (terminal)") */
  label: string;
  /** One-line description shown under the sub-label */
  description: string;
  /**
   * If true, this adapter is optional within the provider — the user can
   * leave it disabled and still consider the provider configured.
   * Example: Claude Code is optional inside the Claude provider.
   */
  optional?: boolean;
}

export interface Provider {
  id: ProviderId;
  /** Display name on the catalog card */
  name: string;
  /** One-line tagline shown under the name */
  description: string;
  /** Tailwind classes used for the brand badge */
  badgeColor: string;
  /**
   * Adapters that belong to this provider, in display order. The first
   * non-optional adapter is treated as the "primary" — its enabled state
   * drives the card's enable toggle.
   */
  adapters: ProviderAdapter[];
  /**
   * If true, all adapters in this provider share authentication (e.g. one
   * Claude OAuth/API key unlocks both Agent and Code). When false, each
   * adapter handles its own auth (e.g. OpenCode uses its own auth.json
   * regardless of any other provider).
   */
  sharedAuth: boolean;
  /** Optional install instructions shown at the top of the configure dialog */
  installNote?: string;
  /** Optional auth instructions shown in the auth section */
  authNote?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic\'s coding models — Agent (chat) and Code (terminal).',
    badgeColor: 'bg-primary/10 text-primary',
    sharedAuth: true,
    authNote: 'Authenticating Claude Code unlocks both Claude Agent (chat) and Claude Code (terminal).',
    adapters: [
      {
        id: 'claw-chat',
        label: 'Agent',
        description: 'Conversational chat with files, artifacts, and inline tools.',
      },
      {
        id: 'claude-code',
        label: 'Code (terminal)',
        description: 'Terminal-style PTY chat with the official Claude CLI.',
        optional: true,
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Multi-provider coding agent. Bring your own provider keys via the OpenCode CLI.',
    badgeColor: 'bg-emerald-500/10 text-emerald-500',
    sharedAuth: false,
    authNote: 'Run `opencode auth login` in a terminal to add a provider (Anthropic, OpenAI, OpenRouter, …). Credentials live at ~/.local/share/opencode/auth.json — we re-check after you click below.',
    adapters: [
      {
        id: 'opencode',
        label: 'Agent',
        description: 'Chat backed by the OpenCode SDK — pick any model from any provider you\'ve added.',
      },
    ],
  },
];

/** Provider that owns a given adapter id, or null if unmapped. */
export function findProviderByAdapter(adapterId: string): Provider | null {
  for (const p of PROVIDERS) {
    if (p.adapters.some(a => a.id === adapterId)) return p;
  }
  return null;
}
