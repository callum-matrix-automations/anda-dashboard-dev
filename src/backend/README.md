# Backend

Server-only application code will live in this directory.

Planned areas:

- `domain/` — meeting lifecycle and business rules
- `services/` — application workflows and provider orchestration
- `integrations/` — Microsoft Graph, AI, PDF, e-signature, and archive adapters
- `repositories/` — Supabase database and storage access
- `auth/` — authentication, accounts, permissions, and authorization checks

Frontend and Client Components must not import from `src/backend`. Backend
operations will be exposed to the browser through thin `src/app/api` route
handlers. No backend implementation exists yet.
