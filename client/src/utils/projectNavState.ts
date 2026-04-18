/**
 * Per-project ephemeral nav state. Holds the last-visited deep route
 * (chat / script) for each project so that switching tabs inside the
 * project preserves the previously open item.
 *
 * State is cleared when the user leaves the project (ProjectDashboardPage
 * unmounts that projectId).
 */

interface ProjectNavState {
  lastChatId?: string;
  lastScriptId?: string;
}

const store = new Map<string, ProjectNavState>();

export function getProjectNavState(projectId: string): ProjectNavState | undefined {
  return store.get(projectId);
}

export function setProjectNavState(projectId: string, patch: Partial<ProjectNavState>): void {
  const existing = store.get(projectId) || {};
  store.set(projectId, { ...existing, ...patch });
}

export function clearProjectNavState(projectId: string): void {
  store.delete(projectId);
}
