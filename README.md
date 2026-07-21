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

The `supabase/` directory contains the local database infrastructure and atomic
transcript-ingestion operation used by the backend.

## Read AI transcript sender

The transcript-intake fixture emulates Read AI's completed-meeting webhook. It combines
the committed metadata fixture in `fixtures/transcripts/dummy-transcript-packet.json`
with the transcript in `fixtures/transcripts/anda-board-meeting.txt` and sends the
complete `meeting_end` JSON packet with an HTTPS POST request.

Inspect the packet without sending it:

```powershell
npm.cmd run mock:transcript -- --dry-run
```

Send it to an HTTPS webhook receiver:

```powershell
npm.cmd run mock:transcript -- https://your-webhook.example/transcripts
```

Alternatively, set `MOCK_TRANSCRIPT_WEBHOOK_URL` in `.env.local` or the current
shell environment and run `npm.cmd run mock:transcript`. HTTPS is required for
remote endpoints; local loopback URLs may use HTTP for development.

The Read AI webhook and receiver must share `READ_AI_WEBHOOK_SIGNING_KEY`. Read AI signs
the exact raw JSON body with HMAC-SHA256 using the decoded Base64 key and sends the
lowercase hexadecimal digest in `X-Read-Signature`. The receiver rejects missing,
malformed, or invalid signatures.

The Next.js backend receives the packet at `POST /api/webhooks/transcripts`. A valid
`meeting_start` event is acknowledged and ignored; a valid `meeting_end` event returns
HTTP `202` with the event, meeting, and transcript identifiers. The receiver validates
and adapts the provider payload, then calls a separate backend workflow that stores an
`AI_PROCESSING` meeting and its immutable transcript in Supabase. Provider metadata,
including nullable participant emails and the original speaker blocks, is retained on
the transcript record.

Valid participant emails are matched exactly against normalized current profile emails.
Only successful matches create `meeting_attendees`; display names never establish identity.
Unmatched participants remain in transcript metadata for later server-side resolution.

Source meeting and transcript identifiers provide durable database idempotency
across restarts and multiple server instances. Meeting and transcript creation
is atomic. Receipt processing makes one initial attempt and up to three retries.
Exhausted retries return a structured `failed` response and create or refresh one
unresolved `transcript_import_failures` alert per Read AI session. A later successful
or duplicate delivery resolves that alert.

## Operational recovery

The backend exposes `POST /api/internal/operations/recover` for an external
scheduler. It reconciles aged Firma requests through the existing callback
processor, retries recoverable archives, and safely dispatches deduplicated
operational alerts. The endpoint uses a dedicated server-only scheduler secret;
overlapping calls use atomic database claims. Telegram is optional and can be
configured later without changing the recovery flow. See
`docs/operations/workflow-recovery.md` for the complete contract and local test
command.

## Meeting approval and PDF generation

The backend `approveMeeting` function explicitly approves reviewed minutes. It
uses the current meeting version, records the supplied existing profile as the
approver, requires acknowledgement of unresolved individual votes, stores an
immutable approved snapshot, and locks the structured meeting record. API
exposure and application authorisation are intentionally deferred.

The backend then generates a versioned unsigned PDF and stores it in the private
`meeting-minutes` Supabase Storage bucket. A `meeting_pdfs` record owns the PDF
metadata and the meeting references it through `unsigned_pdf_id`. The backend
then sends that exact stored PDF to Firma for the configured test Treasurer.
Only confirmed delivery moves the meeting to `AWAITING_SIGNATURE`; PDF failures
remain locked in `PDF_FAILED`, while signing-delivery failures remain locked in
`ESIGN_FAILED`. Both stages have backend retry functions that preserve the
approved snapshot and PDF version.

To run the opt-in live path from the signed dummy webhook through GPT-4.1,
simulated human review, approval, PDF generation, and Firma delivery:

```powershell
npm.cmd run test:workflow:live:full
```

The test preserves the AI-produced minutes and complete formal motions. It
simulates human review by omitting motions whose mover or final outcome is still
unresolved, while retaining proposals explicitly recorded as not seconded, then writes the final PDF to
`output/pdf/anda-live-gpt41-meeting-minutes.pdf` for local visual QA.

## Signing completion and rejection

Firma sends lifecycle events to `POST /api/webhooks/firma`. The endpoint verifies
Firma's timestamped HMAC against the exact raw body, accepts the old signature
during secret rotation, stores immutable event evidence, and schedules outcome
processing after returning. Duplicate event IDs are idempotent; reusing an ID
with different content is rejected.

The outcome processor asks Firma for the authoritative request and recipient
state. A complete request is accepted only when the configured Treasurer has
finished and Firma supplies a full PDF. The PDF header, byte length, and SHA-256
are recorded as `READY_FOR_ARCHIVE`; storing the final signed PDF and moving the
meeting to `COMPLETED` belong to ANDA-009. Missed callbacks can be recovered with
the backend `reconcileMeetingSigning` function.

The backend also provides `getMeetingSigningSession`, `rejectMeetingSigning`, and
`retryMeetingSigningOutcome`. Rejection requires an active Treasurer profile and
a comment, cancels the Firma request, keeps the old PDF/request as history, and
returns the meeting to editable `PENDING_APPROVAL`. These action functions do not
have HTTP routes yet; ANDA-018 owns those APIs.

To run the opt-in live GPT-4.1/Firma callback test, including a temporary HTTPS
Cloudflare tunnel and temporary Firma webhook:

```powershell
npm.cmd run test:signing:live:callback
```

To verify only the tunnel, workspace webhook, and Firma signature without
creating a meeting or signing request:

```powershell
npm.cmd run test:signing:live:webhook
```

The command prints the Firma signing URL and waits up to 15 minutes for you to
sign. It then verifies the real callback, recipient, completed PDF metadata, and
database state before removing the temporary webhook. It requires local
Supabase, `OPENAI_API_KEY`, `FIRMA_API_KEY`, `FIRMA_WORKSPACE_ID`, the matching
workspace-level `FIRMA_WEBHOOK_SECRET`, the test signer values, and `cloudflared`
(the default Windows path is documented in `.env.example`). The runner verifies
a signed test delivery before creating the meeting and printing the signing URL.

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

Run the local database integration test after applying pending migrations:

```powershell
npm.cmd exec supabase migration up --local
npm.cmd run test:integration
```

`supabase:start` starts the CLI-managed Docker stack. `supabase:env` creates or
updates the four Supabase values in `.env.local` without overwriting other
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
