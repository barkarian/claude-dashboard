// === Chat Adapter Abstraction Types ===

/** Capability flags that describe what an adapter can do */
export interface AdapterCapabilities {
  /** Renders via xterm.js terminal (node-pty on backend) */
  terminal: boolean;
  /** Renders via message bubble UI */
  messages: boolean;
  /** Can resume previous sessions */
  resume: boolean;
  /** Watches external files for status (e.g. JSONL) */
  fileWatching: boolean;
  /** Supports tool permission prompts */
  permissions: boolean;
  /** Supports interactive questions (AskUserQuestion) */
  questions: boolean;
  /** Needs prerequisite check (binary on PATH, etc.) before use */
  prerequisites: boolean;
  /** Supports concurrent sessions of this adapter type */
  concurrentSessions: boolean;
}

/** Adapter identity — shared between server and client */
export interface AdapterMetadata {
  /** Unique adapter identifier (used in DB, socket events, URLs) */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description for settings UI */
  description: string;
  /** 2-3 char label for sidebar chat badges (e.g. "CC", "SDK", "OC") */
  shortLabel: string;
  /** Tailwind classes for the sidebar badge (e.g. "bg-primary/10 text-primary") */
  badgeColor: string;
  /** Icon identifier or URL */
  icon: string;
  /** Capability flags */
  capabilities: AdapterCapabilities;
  /** Default configuration template */
  defaultConfig: Record<string, unknown>;
}

/** Badge that an adapter can inject into the shared header area */
export interface HeaderBadge {
  label: string;
  icon?: string;
  tooltip?: string;
}

/** Result of a prerequisites check */
export interface PrerequisiteResult {
  satisfied: boolean;
  /** Human-readable message if not satisfied */
  message?: string;
  /** Optional install command hint */
  installHint?: string;
}
