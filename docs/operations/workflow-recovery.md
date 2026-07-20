# Workflow recovery and operational alerts

ANDA exposes a scheduler-independent recovery job at:

```text
POST /api/internal/operations/recover
Authorization: Bearer <OPERATIONS_SCHEDULER_SECRET>
Content-Type: application/json
```

The external deployment scheduler should call it at the interval documented by
`OPERATIONS_RECOVERY_INTERVAL_MINUTES`. The interval is advisory configuration
for infrastructure; the backend does not depend on a particular scheduler.

The request body may be empty. Bounded overrides are available for controlled
manual runs:

```json
{
  "signingAgeMinutes": 10,
  "signingLimit": 25,
  "signingMaxAttempts": 5,
  "archiveLimit": 25,
  "archiveMaxAttempts": 3,
  "alertLimit": 25,
  "alertMaxAttempts": 3,
  "alertRetryDelaySeconds": 30
}
```

The job atomically claims stale Firma signing requests with database row locks,
re-queries Firma through the existing outcome processor, and leaves requests
open when Firma still reports them as pending. Overlapping job runs cannot claim
the same request. Completed signing outcomes flow into the existing idempotent
archive processor. Archive retries retain the verified PDF checksum and size and
never modify an already completed meeting.

The response reports signing reconciliation, archive recovery, and alert
delivery results separately. Exhausted work remains visible in `ESIGN_FAILED` or
`ARCHIVE_FAILED` with its last safe error code.

## Operational alerts

Failures are persisted before external delivery. One unresolved alert is kept
per deduplication key; repeated failures increment its occurrence count. A later
successful recovery resolves it. Delivery attempts use database claims and
bounded backoff, so multiple workers cannot send the same pending alert.

Telegram delivery is disabled until both `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` are configured. Recovery continues normally while Telegram
is unconfigured or unavailable. Messages contain only the workflow stage,
failure code, status, internal meeting or source reference, and timestamp. They
never include transcripts, minutes, attendee emails, PDF content, credentials,
provider payloads, or user comments.

The adapter uses Telegram Bot API `sendMessage` with plain text and no parse
mode. Create the bot and destination after the backend feature is deployed, then
add the two server-only environment values.

## User issue reports

Authenticated application users can call:

```text
POST /api/issues/report
Content-Type: application/json

{
  "meetingId": "<meeting UUID>",
  "comment": "Optional comment up to 2,000 characters"
}
```

The comment is stored in `operational_issue_reports` but is never copied into a
Telegram alert. Production access remains fail-closed until the production
authentication work supplies the server actor resolver. Local development uses
the configured `ANDA_DEV_ACTOR_PROFILE_ID`.

## Local verification

Apply migrations and run the recovery suite:

```powershell
npm.cmd exec supabase migration up --local
npm.cmd run test:operations
```

The deterministic suite does not require a Telegram bot. Telegram HTTP behavior
is verified with an injected provider; a real bot can be tested after its token
and chat ID are configured.
