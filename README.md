# ANDA Dashboard

## Application structure

The repository contains a Next.js modular monolith: the frontend, browser-safe
contracts, backend services, Supabase persistence and external integrations. The previous in-browser repository simulation, fixture records,
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
and show an unavailable state when the backend cannot be reached.

The `supabase/` directory contains the local database infrastructure and atomic
transcript-ingestion operation used by the backend.

## Accounts and roles

The app uses Supabase email/password accounts with a server-verified active profile.
Members self-register with their name, email and chosen password and can view records.
Only the President can upload, edit, prepare or discard drafts. The President,
Vice President and Treasurer can approve; only the assigned Treasurer can open
signing sessions or reject them. Authorised operators can reset passwords; there is
no Microsoft OAuth flow. See [board accounts](#anda-025-board-accounts) and
[staging setup](docs/deployment/railway-staging.md) for roles, migrations and legacy
signing requests.

`APP_ORIGIN` must match the browser's public origin. `SUPABASE_PUBLISHABLE_KEY`
configures Auth; `SUPABASE_SECRET_KEY` stays on the server. Local seeded accounts
use `local-only-password`; these fixtures must never be loaded into client staging.
The local role-test logins are `ernesto@example.com` (Officer),
`richard@example.com` (Treasurer), and `james.wilson@example.com` (User).
These reserved example addresses are confirmed locally and require no mailbox.
Run `npm.cmd run test:accounts` with local Supabase for the account/discard tests.
When running a second local test server, set `ANDA_NEXT_DIST_DIR` to a distinct
`.next-*` directory to keep it separate from the port-3000 dev output.

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

Valid Read AI participant emails are matched exactly against normalized current
profile emails. Manual uploads may also link an exact, unique display-name match.
Every source participant creates a `meeting_attendees` row, even when no profile
exists. Unlinked attendees keep a null `profile_id`, remain available to AI and
human review, and can be linked later without preventing the workflow.

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

To run the opt-in live path from the signed dummy webhook through GPT-5.6 Terra,
simulated human review, approval, PDF generation, and Firma delivery:

```powershell
npm.cmd run test:workflow:live:full
```

The test preserves the AI-produced minutes and complete formal motions. It
simulates human review by omitting motions whose mover or final outcome is still
unresolved, while retaining proposals explicitly recorded as not seconded, then writes the final PDF to
`output/pdf/anda-live-gpt56-terra-meeting-minutes.pdf` for local visual QA.

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

To run the opt-in live GPT-5.6 Terra/Firma callback test, including a temporary HTTPS
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

For the client-test deployment on Railway and hosted Supabase, follow
`docs/deployment/railway-staging.md`. Docker Desktop is not required on the
deployed service; Railway builds the repository's root `Dockerfile`.

Local Logflare analytics is disabled because on Windows it requires exposing
the Docker daemon over an unauthenticated TCP socket. This does not disable the
application services: Postgres, Auth, REST, GraphQL, Realtime, Storage, Studio,
local email capture, or Edge Functions.

## ANDA-025 board accounts

Members register themselves at `/auth/register` using their name, email and chosen
password, then sign in normally. No invitation code, approved email roster, operator
approval or email delivery is required. Registration immediately creates an active
read-only `USER` profile, never an Officer or administrative account. Anyone who can
reach registration can create a Member account and read board records; this is the
client-requested self-service model. Existing accounts cannot be replaced or have
their passwords changed through registration.

`OFFICER` profiles now have an explicit nullable `board_position`: `PRESIDENT` or
`VICE_PRESIDENT`. Only the President can upload transcripts, change draft minutes,
attendance, motions and votes, retry analysis/normalization, prepare, defer, resume or
discard drafts. President, Vice President and Treasurer may approve and retry approved
PDF/signature delivery. Only the Treasurer assigned to the saved signing request can
sign or return it. All active members may read records. Property Centre and Financial
Records retain their existing role rules.

Before deploying, apply these additive migrations in order:

- `20261011100000_board_positions_and_registration.sql`
- `20261011100100_revoke_session_read_access.sql`
- `20261011100200_revoke_session_write_access.sql`

Existing profile IDs, approvals, history and signing-recipient snapshots are preserved.
There is deliberately no automatic President assignment. Inventory existing profiles,
confirm the real President's UUID with the client, and explicitly assign that Officer.
Leave the real vacant Vice President seat empty. Unique indexes permit at most one
active President, Vice President and Treasurer. Local seed positions are synthetic
test fixtures only and must never be copied into hosted accounts.

In hosted Supabase, disable public and anonymous signup and set the minimum password
length to 12. Keep the email provider enabled for password login; disable signup globally,
not the email provider itself. The server uses Auth administration for self-service registration
through the application endpoint (not direct Supabase signup);
direct Auth signup cannot provision a board profile even if mistakenly enabled. Local
`supabase/config.toml` uses these settings; restart the local stack to load changes.
Set `APP_ORIGIN` to the exact dashboard URL, including its local port. Existing
Supabase, Firma and AI environment variables remain unchanged; no new Railway
environment variables are required by ANDA-025.

Operator examples (run against the deliberately selected environment):

```powershell
npm run account:manage -- --action position --id <confirmed-officer-uuid> --position PRESIDENT
npm run account:manage -- --action position --id <officer-uuid> --position NONE
```

The previous invitation table/functions remain as unused historical schema; no new
migration is needed to remove the code requirement. Operator tools no longer issue
invitations. If account creation already succeeded, sign in instead. Registration
never resets an existing account. If profile creation fails, only the newly created
Auth-only identity is eligible for cleanup; uncertain outcomes require operator review.

For a password reset, verify the member's identity privately, set the temporary shell
variable `ANDA_ACCOUNT_PASSWORD` to the new password (12–128 characters), then run:

```powershell
npm run account:manage -- --action reset --id <member-profile-uuid>
Remove-Item Env:ANDA_ACCOUNT_PASSWORD
```

Privately deliver the replacement password; do not put it in command arguments or logs.
The tool cannot read the old password, does not change roles, and revokes existing Auth
sessions. Protected app requests and direct database policies reject revoked session IDs,
including still-unexpired access JWTs. Existing signed document download links retain
their normal short expiry. Operator access requires the server-only Supabase secret;
being President or Treasurer does not grant password-reset authority.

Run `npm run test:board-accounts` with local Supabase for registration, concurrency,
duplicate protection, privilege injection, password reset, revoked-session and role-matrix tests.
The wider local integration suite uses predefined analysis and fake signing providers;
real OpenAI/Firma checks are separate and must not be confused with offline tests.
