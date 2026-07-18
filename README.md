# ANDA Dashboard

## Application structure

The repository currently contains the Next.js frontend and browser-safe API
contracts. The previous in-browser repository simulation, fixture records,
lifecycle engine, fake permissions, and demo authentication have been removed.

```text
src/
|-- app/                    Next.js routes and layouts
|-- frontend/
|   |-- api-client/         Typed HTTP client for future /api routes
|   |-- components/         Browser UI and presentation
|   |-- hooks/              React Query API hooks
|   |-- presentation/       Display-only projections and formatting
|   `-- utils/              Browser-only utilities
`-- shared/
    |-- contracts/          API request and response shapes
    |-- schemas/            Browser-safe Zod schemas
    `-- types/              Shared TypeScript exports
```

Frontend code may import only `src/frontend` and `src/shared`. It must not
contain authoritative lifecycle, authorization, persistence, integration, or
credential-handling logic. Data-backed screens call typed `/api/...` endpoints
and intentionally show an unavailable state until those endpoints are built.

The `supabase/` directory remains as database infrastructure for the later
backend implementation; no application code currently connects to it.

## Local development

Requirements:

- Node.js 22
- Docker Desktop with the Docker engine running

Install dependencies and start the complete local Supabase stack:

```powershell
npm.cmd ci
npm.cmd run supabase:start
npm.cmd run supabase:env
npm.cmd run dev
```

`supabase:start` starts the CLI-managed Docker stack. `supabase:env` creates or
updates the three Supabase values in `.env.local` without overwriting other
application settings. Do not commit `.env.local`.

Keep the operating system firewall enabled. Supabase CLI publishes its local
ports on all network interfaces, so this stack must not be run on an untrusted
network or exposed through router port forwarding.

Local services:

| Service | Address |
| --- | --- |
| Next.js | http://localhost:3000 |
| Supabase API | http://127.0.0.1:54321 |
| Postgres | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Supabase Studio | http://127.0.0.1:54323 |
| Local email viewer | http://127.0.0.1:54324 |

Useful commands:

```powershell
npm.cmd run supabase:status
npm.cmd run supabase:env
npm.cmd run supabase:reset
npm.cmd run supabase:stop
```

`supabase:reset` destroys only the local database, reapplies every committed
migration, and then applies `supabase/seed.sql`.

## Database migrations

Create a migration for every schema or data-structure change:

```powershell
npm.cmd run supabase:migration:new -- describe_the_change
```

Write the SQL in the generated file under `supabase/migrations/`, then run:

```powershell
npm.cmd run supabase:reset
```

Commit migrations with the feature that needs them. Once a migration has been
shared, do not rewrite it; add a corrective migration instead.

Migration approval follows the Git branches:

| Branch | Database meaning |
| --- | --- |
| `development` | Shared local-development migrations |
| `staging` | Reviewed migrations approved for the staging database |
| `main` | Staging-verified migrations approved for production |

Merging a branch only moves migration files. It does not change a remote
database automatically. Until a deployment workflow is intentionally added,
the senior developer links and pushes migrations to staging and production
manually after reviewing them.

## Environment configuration

The application uses the same variable names in every environment:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

Local values point at Docker. Staging and production must use separate Supabase
projects and their corresponding values. The secret key is server-only and must
never be prefixed with `NEXT_PUBLIC_` or committed to Git.

The local Supabase Docker stack is for development only. Do not expose it to
the public internet or use it as the staging or production service.

Local Logflare analytics is disabled because on Windows it requires exposing
the Docker daemon over an unauthenticated TCP socket. This does not disable the
application services: Postgres, Auth, REST, GraphQL, Realtime, Storage, Studio,
local email capture, or Edge Functions.
