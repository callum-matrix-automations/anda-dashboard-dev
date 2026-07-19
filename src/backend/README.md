# Backend

Server-only application code lives in this directory.

Planned areas:

- `domain/` - meeting lifecycle and business rules
- `services/` - application workflows and provider orchestration
- `integrations/` - transcript, AI, PDF, e-signature, and archive adapters
- `repositories/` - Supabase database and storage access
- `auth/` - authentication, accounts, permissions, and authorization checks

Frontend and Client Components must not import from `src/backend`. Backend
operations are exposed through thin `src/app/api` route handlers.

The first backend endpoint is `POST /api/webhooks/transcripts`. It validates a
provider-neutral transcript packet, passes it to the transcript receive service,
and returns a received, duplicate, or failed result. Requests require a fresh
HMAC-SHA256 signature using `TRANSCRIPT_WEBHOOK_SECRET`. Successful transcript
identifiers are idempotent in Supabase. The receive service calls a separate
transcript import workflow, which uses a server-only repository and restricted
database function to create the meeting and immutable transcript atomically.
The receive operation makes one initial attempt plus three retries before
returning a failed result. Fallback queuing after exhausted retries is deferred.

After a new transcript is stored, the receive service schedules the separate
meeting-analysis workflow to run after the webhook response. That workflow claims up to three durable attempts,
calls the structured OpenAI analyser, and atomically saves minutes, motions,
and votes before moving the meeting to `PENDING_APPROVAL`. The source transcript
is never updated. A third failed attempt records a sanitised reason and moves
the meeting to `AI_FAILED`.

`POST /api/internal/meetings/{meetingId}/analysis` runs the same workflow for
testing and manual recovery. It requires `Authorization: Bearer <token>` using
the server-only `INTERNAL_ANALYSIS_SECRET`. Manual recovery resets an
`AI_FAILED` meeting to a new three-attempt cycle. Active run tokens, lifecycle
state, and permanent human ownership prevent duplicate or late AI responses
from overwriting reviewable content.

Backend meeting-review services provide the server-side operations needed before
approval. They list meeting records, load a complete review aggregate with the
immutable transcript, and atomically replace editable minutes, attendees,
motions, votes, and tags. Officer and treasurer edits use optimistic version
checks, permanently mark the content as human-owned, and add review history.
Meetings can also be deferred with a required note and resumed without changing
their lifecycle status.

An officer or treasurer can manually complete an `AI_FAILED` record. Saving the
replacement draft leaves it in `AI_FAILED` until `markMeetingReady` verifies the
minimum content and moves it to `PENDING_APPROVAL`. Stored failure details remain
available for audit. Approval is deliberately excluded from these services and
belongs to the next workflow item; no meeting-review API routes are introduced
here.

## Pre-approval workflow tests

`npm.cmd run test:workflow` sends a correctly signed dummy transcript through
the webhook handler, real local Supabase ingestion, a predefined AI response,
and draft persistence. It verifies that the meeting reaches
`PENDING_APPROVAL`, the transcript remains unchanged, and a durable duplicate
does not start analysis again.

`npm.cmd run test:workflow:live` follows the same path with the real GPT-4.1
analyser. It requires local Supabase and `OPENAI_API_KEY`, makes a chargeable
external API request, and is intentionally separate from the deterministic
integration suite.

`npm.cmd run test:reviews` exercises the backend review lifecycle against local
Supabase. It covers complete draft editing, optimistic-lock conflicts,
permissions, deferral and resumption, immutable transcripts, AI ownership
protection, review history, and manual recovery from `AI_FAILED`.
