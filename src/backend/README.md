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
