# Read AI transcript integration

ANDA consumes the completed-meeting (`meeting_end`) structure published by Read AI. The provider payload is converted at the backend boundary into ANDA's internal transcript-import packet; downstream AI, review, PDF, signing, and archive services do not depend on Read AI field names.

## Official references

- [Getting Started with Webhooks](https://support.read.ai/hc/en-us/articles/16352415827219-Getting-Started-with-Webhooks)
- [API Reference](https://support.read.ai/hc/en-us/articles/49381161088659-API-Reference)
- [API Keys and Authentication](https://support.read.ai/hc/en-us/articles/49380809380371-API-Keys-Authentication)

These references were checked on 20 July 2026. The REST API is not used by this integration because the `meeting_end` webhook already contains the completed transcript.

## Accepted event

`meeting_end` is the only event that creates ANDA data. A workspace `meeting_start` event is authenticated and acknowledged as ignored because it does not yet contain a report or transcript.

Required completed-meeting fields include:

- `session_id`
- `request_id`
- `title`
- `start_time` and `end_time`
- `participants`
- `owner`
- `transcript.speaker_blocks`
- `platform` and `platform_meeting_id`
- `report_url`

Read AI participant emails are nullable. ANDA trims and lowercases valid emails, then matches them exactly against the current email of one active member profile. Display names are never used for identity matching.

Successful matches create `meeting_attendees` associations using permanent profile IDs and retain the source display name and email snapshots. Missing, invalid, unknown, or ambiguous emails do not create associations. Those participants remain available in immutable transcript metadata and can be checked again by the backend `resolveUnmatchedTranscriptParticipants` function after a profile becomes available.

## Authentication

Read AI signs the exact raw request body with HMAC-SHA256. The webhook signing key displayed by Read AI is Base64 encoded and must be decoded before it is used as the HMAC key. Read AI places the lowercase hexadecimal digest in `X-Read-Signature`.

The server-only environment variable is:

```text
READ_AI_WEBHOOK_SIGNING_KEY=<base64 signing key>
```

Read AI does not include a signed timestamp. Replay and duplicate protection therefore use the provider's `request_id` as the delivery reference and `session_id` as the durable meeting/transcript identity.

## Mapping into ANDA

| Read AI | ANDA |
| --- | --- |
| `request_id` | Receipt event ID |
| `session_id` | `read_ai:<session_id>` source meeting and transcript ID |
| `title` | Meeting title |
| `start_time` | Meeting date and exact source metadata |
| `end_time` | Exact source metadata and calculated duration |
| `participants` | Source participant names and nullable emails |
| `transcript.speaker_blocks` | Ordered deterministic plain-text transcript and raw metadata |
| `platform`, `platform_meeting_id` | Transcript metadata |
| `owner`, `report_url` | Transcript metadata |
| summaries, topics, questions, chapters, actions | Transcript metadata only |

Duration is rounded up to a whole minute for the existing ANDA meeting model. Exact source timestamps remain in transcript metadata. Read AI does not provide a transcript language field, so the internal language is `und` (undetermined).

ANDA does not use Read AI's generated summary or action items as approved minutes. Its GPT-5.6 Terra analysis operates on the complete speaker-attributed transcript.

## Delivery and failure behaviour

Read AI documents five retries after an initial non-2xx response. ANDA performs its existing three internal persistence retries before returning a retryable failure. Exhausted imports create one unresolved `transcript_import_failures` record per Read AI session. A later successful or duplicate delivery resolves that record.

The repository includes a manual Read AI-format sender:

```powershell
npm.cmd run mock:transcript -- http://localhost:3000/api/webhooks/transcripts
```

This work item does not configure a production Read AI webhook or public deployment URL.
