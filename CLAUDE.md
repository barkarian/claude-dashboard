# Claw Platform — Agent Instructions

Read `plan.md` for the full architecture and phased implementation plan.

## Project Structure

```
claude-code-mobile/
├── claude-dashboard/       # Dashboard app (Express + Socket.IO server, React + Vite client)
│   ├── server/             # Express server (ES modules, TypeScript)
│   │   ├── index.ts        # Server entry point, middleware, socket setup
│   │   ├── config.ts       # ServerConfig, reads env vars
│   │   ├── services/       # Business logic (projectManager, processManager, fileService, etc.)
│   │   └── routes/         # Express route handlers (projects.ts, scripts.ts, etc.)
│   ├── client/             # React + Vite app
│   │   └── src/
│   │       ├── context/    # React contexts (ProjectContext, etc.)
│   │       ├── pages/      # Page components (ProjectListPage, NewProjectPage, etc.)
│   │       ├── components/ # UI components
│   │       └── utils/      # API utility (api.ts), helpers
│   ├── shared/             # Shared TypeScript types (used by both server and client)
│   │   └── types/
│   │       ├── models.ts   # Project, Script, Chat, ChatHistoryEntry, etc.
│   │       ├── server.ts   # ServerConfig, session types
│   │       └── socket-events.ts
│   └── package.json        # Workspace root (workspaces: ["server", "client"])
│
├── tunnel-service/         # Central platform (Payload CMS + Express + WebSocket tunnel)
│   ├── src/
│   │   ├── collections/    # Payload CMS collections (Users, Endpoints, AuthorizationCodes)
│   │   ├── tunnel/         # WebSocket tunnel (wsServer.ts, proxyServer.ts, protocol.ts)
│   │   ├── lib/            # Utilities (urlBuilder.ts)
│   │   ├── views/          # HTML templates (login.html, signup.html)
│   │   ├── server.ts       # Main server: Express routes + Next.js + HTTP routing
│   │   └── payload-types.ts # Auto-generated types
│   ├── payload.config.ts   # Payload CMS config (PostgreSQL, collections, admin)
│   └── package.json
│
├── plan.md                 # Full architecture and implementation plan
└── CLAUDE.md               # This file
```

## Codebase Conventions

### claude-dashboard (server)

- **ES Modules**: `"type": "module"` in server/package.json. Use `import`/`export`, include `.ts` extension in local imports.
- **Service pattern**: Services export a default object with methods (NOT classes):
  ```typescript
  // Good
  function listProjects() { ... }
  function getProject(id: string) { ... }
  export default { listProjects, getProject };

  // Bad — do NOT use classes
  export class ProjectManager { ... }
  ```
- **Route pattern**: Express Router, default export:
  ```typescript
  const router = Router();
  router.get('/', handler);
  export default router;
  ```
- **Config pattern**: Single `config.ts` exporting a typed config object from env vars.
- **ID generation**: Use `uuid` package (`import { v4 as uuidv4 } from 'uuid'`).
- **No dependency injection**: Services use module-level state and are imported directly.
- **Async/await**: All async operations use async/await, not callbacks or raw promises.

### claude-dashboard (client)

- **React + Vite + TypeScript**
- **API calls**: Use `client/src/utils/api.ts` utility:
  ```typescript
  import api from '../utils/api';
  const data = await api.get<{ projects: ProjectSummary[] }>('/api/projects');
  ```
- **Context pattern**: React Context + Provider + custom hook (`useProject`, etc.)
- **No state management library**: Just React Context + useState.

### tunnel-service (Payload CMS)

- **Collection pattern**: Each collection in its own file in `src/collections/`, uses `CollectionConfig` type:
  ```typescript
  import type { CollectionConfig } from 'payload';
  export const MyCollection: CollectionConfig = {
    slug: 'my-collection',
    fields: [ ... ],
    access: { ... },
    hooks: { ... },
  };
  ```
- **Access control**: Query-based patterns using `req.user`:
  ```typescript
  read: ({ req }) => ({ user: { equals: req.user.id } })
  ```
- **Auth pattern**: API key via `Authorization: users API-Key <key>` header. Verified with HMAC-SHA1/SHA256 against `payload.secret`.
- **Route pattern**: Express routes defined inline in `src/server.ts` (not separate route files). Auth checked with `authenticateRequest(req, payload)` helper.
- **Collections registered** in `payload.config.ts` in the `collections` array.
- **Barrel exports**: Collections re-exported from `src/collections/index.ts`.
- **Relationship fields**: Use `type: 'relationship', relationTo: 'collection-slug'`. Extract ID via `typeof x === 'object' ? x.id : x`.

## Rules

1. **Only work on the phase you are told to work on.** Do not bleed into other phases. If something is needed from a future phase, leave a `// TODO: Phase X` comment.

2. **No migration scripts.** The old `.claude-dashboard/config.json` system is being fully replaced. Do NOT write code to import old JSON data into SQLite. Start fresh.

3. **Match existing patterns exactly.** Read the existing code first. If services use default object exports, do the same. If routes use inline handlers, do the same. Don't introduce new patterns.

4. **Keep the same API shape where possible.** The REST endpoints (`GET /api/projects`, `POST /api/projects`, etc.) should keep the same request/response format so the client doesn't break unnecessarily.

5. **Don't over-engineer.** No ORMs, no migration frameworks, no dependency injection. `better-sqlite3` with raw SQL is fine. Payload handles its own schema.

6. **Test by running it.** After making changes, verify the server starts and basic operations work. For claude-dashboard: `cd server && npx tsx index.ts`. For tunnel-service: `npm run dev`.

7. **One database file.** The SQLite database lives at `claude-dashboard/data/dashboard.sqlite` (the `data/` directory should be gitignored). Do not create separate databases per project.

8. **payload-template/ directory is unused.** Ignore it completely. All Payload CMS work happens in tunnel-service/.
