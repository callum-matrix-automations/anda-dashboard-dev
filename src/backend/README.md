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
HMAC-SHA256 signature using the Base64-decoded `READ_AI_WEBHOOK_SIGNING_KEY`. Successful transcript
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
available for audit.

## Approval and unsigned minutes PDF

`approveMeeting` is the backend approval boundary. It accepts the current
meeting version, an existing approver profile ID, and an unresolved-vote
acknowledgement. It rejects stale or deferred records, validates the minutes and
motion information, and requires explicit acknowledgement when unresolved
individual votes remain. API exposure, authentication, and role authorisation
are intentionally deferred to a separate work item.

Accepted approval atomically stores an immutable structured snapshot, records
the approver, locks the meeting, and moves it to `PDF_PROCESSING`. The backend
processor claims the snapshot, builds a versioned ANDA minutes document, renders
a multi-page PDF, and uploads it to the private `meeting-minutes` Supabase
Storage bucket. It then creates an immutable `meeting_pdfs` record containing
the checksum, size, page count, path, and generation time, and assigns that
record to `meetings.unsigned_pdf_id`. The meeting remains in `PDF_PROCESSING`
until the signing-delivery workflow has routed that exact stored PDF.

Generation or storage failure records a sanitised reason and moves the locked
meeting to `PDF_FAILED`. `retryMeetingPdf` uses an optimistic version check and
never rebuilds the approval snapshot; it generates the same document version
from the content that was explicitly approved. Treasurer signing, rejection,
API exposure, and authorisation are separate workflow items.

## Firma signing delivery

`processMeetingSigning` claims one delivery attempt for the current
`unsigned_pdf_id`, downloads that private object, and verifies its byte length
and SHA-256 checksum against the immutable `meeting_pdfs` row. A provider-neutral
interface then uses the server-only Firma adapter to create a document-based
draft containing the configured test Treasurer and signature anchor.

The external request ID is persisted before Firma is asked to send it. A send
failure therefore moves the locked meeting to `ESIGN_FAILED` without losing the
request reference. `retryMeetingSigning` requires an active Treasurer profile
and reuses the same PDF and existing Firma request. One durable request per PDF
and deterministic provider reconciliation prevent duplicate envelopes after
concurrency or an ambiguous network response. Confirmed delivery is the only
path to `AWAITING_SIGNATURE`.

Firma credentials and configured test-recipient values are server-only. Client
Components must never import the adapter or receive `FIRMA_API_KEY`. Firma
completion is received at `POST /api/webhooks/firma`. The endpoint verifies the
Firma raw-body signature and rotation header, persists immutable/idempotent event
evidence, and schedules processing after its response. Outcome processing always
re-queries Firma, verifies the expected recipient and complete PDF, and records
its checksum and size as `READY_FOR_ARCHIVE`. Because Firma can report `finished`
before the generated PDF is available, the adapter waits five seconds before the
first download and retries temporary download failures three times at five-second
intervals. It does not archive the final PDF or mark the meeting `COMPLETED`; those
are the next archive work item.

`reconcileMeetingSigning` handles missed callbacks through the same provider
verification path. `getMeetingSigningSession` returns the configured recipient's
Firma signing URL. `rejectMeetingSigning` requires a current version, active
Treasurer profile, and mandatory comment before cancelling Firma and returning
the record to editable `PENDING_APPROVAL`. Reapproval creates a new immutable PDF
and signing request while retaining the rejected version. Completion failures,
rejection failures, retries, duplicate callbacks, and stale callbacks are all
durable. HTTP APIs for these backend actions remain deferred to ANDA-018.

## Completed meeting archive

After Firma completion is independently verified, the webhook background
workflow calls the separate archive processor. The processor claims the current
`READY_FOR_ARCHIVE` request, downloads the completed PDF again from Firma,
checks its byte length and SHA-256 against the signing evidence, and writes it
to a deterministic `signed/` path in the private `meeting-minutes` bucket. It
then removes the temporary unsigned object, creates an immutable `SIGNED`
`meeting_pdfs` record, assigns `meetings.signed_pdf_id`, and moves the meeting
to `COMPLETED`.

Storage and provider failures are retried three times at five-second intervals.
After those retries, the signature evidence remains unchanged and the meeting
moves to `ARCHIVE_FAILED`. `recoverMeetingArchives` finds both durable failures
and stale archive claims and reuses the same Firma request; it never asks the
Treasurer to sign again. `POST /api/internal/archive/recover` exposes that
recovery entry point for the eventual deployment scheduler.

Completed meetings are immutable and searchable by title, date, category,
manual tags, approved minutes, and motion text. Raw transcript evidence is not
included. `GET /api/archive` lists and filters completed meetings,
`GET /api/archive/{meetingId}` returns one completed record, and
`GET /api/archive/{meetingId}/document` creates a short-lived Supabase signed
URL. These temporary APIs require `Authorization: Bearer <ARCHIVE_API_SECRET>`
until end-user authentication replaces the server-side boundary. The bucket
remains private and no permanent public document URL is stored.

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

`npm.cmd run test:approval` exercises approval validation and acknowledgement,
database locking, PDF generation, the meeting-to-PDF foreign-key association,
private Storage, `PDF_FAILED`, provider delivery, `ESIGN_FAILED`, and successful
retry to `AWAITING_SIGNATURE`.

`npm.cmd run test:signing` adds local-Supabase signing completion, missed-callback
recovery, idempotency, rejection/reapproval history, terminal failure, and
Treasurer retry coverage. `npm.cmd run test:signing:live:callback` is the opt-in
real GPT-4.1/Firma path: it starts Next.js, opens a temporary Cloudflare tunnel,
registers a temporary webhook against `FIRMA_WORKSPACE_ID`, verifies a signed test
delivery with that workspace's secret, prints the signing URL, waits for the human
signature, verifies `READY_FOR_ARCHIVE`, and removes the temporary webhook. Use
`npm.cmd run test:signing:live:webhook` to stop after the signed delivery preflight.
