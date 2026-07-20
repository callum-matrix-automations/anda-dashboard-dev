# Elevateo OS — Meeting Capture Output Format Specification

**For:** Callum / ANDA integration **Prepared:** Saturday 2026-07-18, extracted directly from the Elevateo CRM source code (not from memory or docs). Every field below is traced to the code that writes it. **Status:** Staged draft — Arnis to review and send. **Revision:** 3 — recommendations section (§7) appended on Arnis's 19:38 instruction (advisory, additive-only; §§1–6 byte-identical to the tri-reviewed Revision 2, diff-verified). Revision 2 — tri-model review applied (2026-07-18). All 15 findings (S1–S15) from the blind adversarial review round are fixed in that revision. Verdict artefacts: /tmp/hub13-callum-rev-FABLE.md (FINDINGS(9)) · /tmp/hub13-callum-rev-CODEX.md (FINDINGS(16)) · /tmp/k3-gate-callum-spec.64517/k3-verdict.jsonl (BLOCK(1)+minors); synthesis index: CALLUM-SPEC-TRI-REVIEW-SYNTHESIS-2026-07-18.md.

All sample data in this document is fabricated. No real meeting content, names, or company data appears anywhere below.

---

## 1\. What the tool is, in one paragraph

The Elevateo OS meeting tool is an automated notetaker: a bot (built on the open-source Attendee project) joins Google Meet calls, records and transcribes them, and pushes the result into the Elevateo CRM. The CRM then runs a post-processing pipeline — transcription fallback, an AI summary (Claude, structured tool-output), action-item extraction — and stores everything as rows in a Postgres (Supabase) database. When processing completes, the CRM **emits a signed outbound webhook (meeting.processed) designed specifically for external consumers**. That webhook is the integration surface ANDA should build against.

---

## 2\. Integration surface for ANDA: the meeting.processed webhook

### 2.1 Delivery mechanism

* **Push, not poll.** ANDA hosts an HTTPS endpoint; Elevateo configures the CRM to POST to it (the target URL and shared secret are server-side configuration on our end — exchanged separately, never in this document).

* Fired after the post-processing pipeline (transcription fallback, summary, action items) completes. An internal coaching step also runs before delivery, but it is fail-open: coaching failures are logged and contained, and never block or suppress the webhook. The delivery precondition is simply that summarisation returned without throwing — see §6, note 11 for the one rare failure shape that can still reach ANDA.

* Content-Type: application/json, body is the JSON payload in §2.3. The body is UTF-8 (see §2.2).

* **Best-effort, no retries.** If ANDA's endpoint is down or returns non-2xx, the event is logged on our side but not re-sent. There is currently no replay or poll API (see §6, note 7).

* Delivery timeout is 15 seconds — respond 2xx quickly and process asynchronously.

* **Re-delivery is possible.** The upstream capture bot can legitimately reach a terminal state more than once (e.g. a meeting that ends and whose upstream data is later deleted on retention expiry); each occurrence re-runs the pipeline and fires the webhook again. A repeat event carries the same meeting\_id, MAY carry duplicated action\_items, and when duplicates exist its summary pick is non-deterministic. **Consumers must deduplicate on meeting\_id and keep the first event received — this is required, not recommended.**

* **Payload size is not bounded in code.** Typical payloads are a few kilobytes; summary.text is bounded in practice by the generation cap (\~2,048 model tokens), but action\_items and participants are unbounded arrays, and action\_items can double under re-delivery (previous bullet). Size your request-body limit generously rather than defaulting to a small proxy cap that silently rejects large meetings.

### 2.2 Authentication (structural description — no secret values)

Each request carries an HMAC signature header:

X-Meeting-Signature: \<hex-encoded HMAC-SHA256 digest\>

* Algorithm: HMAC-SHA256.

* Key: the **UTF-8 bytes of a shared secret string** (exchanged out of band). Use the string exactly as given — do not base64-decode or otherwise transform it.

* Message: the **exact raw HTTP request body bytes as received**. Do not re-parse and re-serialise the JSON before verifying — key order matters; verify against the raw body. The signed material is the UTF-8 encoded body: verify over the raw bytes without transcoding — non-ASCII content (accented names, non-Latin scripts) travels as raw multi-byte UTF-8 and is covered by the MAC as such. The Content-Type header carries no charset parameter; the body is always UTF-8.

* Digest encoding: 64 lowercase hexadecimal characters. Match the X-Meeting-Signature header name case-insensitively (HTTP header names are case-insensitive).

Verification pseudocode:

expected \= hex( hmac\_sha256( utf8\_bytes(shared\_secret), raw\_request\_body ) )  
valid    \= constant\_time\_equal( expected, header\["X-Meeting-Signature"\] )

Known-answer test vector (fully fabricated — this secret is not, and will never be, a live value):

secret (string)   : anda-test-secret  
body (exact bytes): {"event":"meeting.processed","meeting\_id":"00000000-0000-4000-8000-000000000000"}  
expected header   : X-Meeting-Signature: c677d43ec12e3f60ac23d3687af393bf8cb83c8e0f807fd9042115cc77560d93

**Do not copy an inbound Attendee-webhook verifier** (ours, or the upstream Attendee project's) to verify this webhook: that is a materially different scheme — base64-decoded key, canonicalised key-sorted JSON, base64 digest. This outbound scheme is: raw secret string as UTF-8 key, raw body bytes, lowercase hex digest.

There is no timestamp or replay-protection field in the scheme; the mandatory keep-first dedupe on meeting\_id (§2.1) also covers replayed requests.

### 2.3 Payload schema

Top-level object (MeetingProcessedPayload):

| Field | Type | Nullable | Description |
| :---- | :---- | :---- | :---- |
| event | string | never | Always the literal "meeting.processed". Identifies the event type only — there is no schema version field (see §2.6). |
| meeting\_id | string (UUID) | never | The CRM's stable meeting identifier. Dedupe key. |
| title | string | yes | Meeting title from the calendar event. Null when the calendar watcher had no title. |
| started\_at | string (RFC 3339 timestamp) | yes | Scheduled start from the calendar event, passed through from the database. Format: RFC 3339 with numeric UTC offset, e.g. 2026-07-18T14:00:00+00:00, second precision — parse with a full RFC 3339 parser, not a fixed format string. **This format differs from sent\_at.** Null when unknown. |
| status | string | yes | Meeting lifecycle status at send time. Normally "processed"; in one rare race condition it can arrive as "failed" with summary: null and action\_items: \[\] (see §6, note 11\) — consumers should check it. Full enum: captured, processing, processed, failed. Nullable only defensively (the sender null-coalesces a failed row read); in practice always set. |
| meeting\_url | string | yes | The Google Meet URL (e.g. https://meet.google.com/xxx-xxxx-xxx). Stored NOT NULL; nullable here only defensively (null if the meeting row cannot be read at send time). |
| participants | array of string | never (may be empty) | Display names of detected speakers, as spoken-name strings only — **no emails**. Entries matching the bot-name pattern (exact regex in §6, note 12\) are removed — a name heuristic, not an identity check. Unordered; a speaker roster, not an attendance list (§6, note 12). May legitimately be empty on fallback-transcribed meetings even when people spoke (§6, note 13). |
| summary | object | yes | Null if no summary insight exists (the §6 note 11 race). See below. |
| summary.text | string | yes | Prose summary. The model is asked for 5–8 sentences (topics, outcome, next steps); the length is requested, not enforced. AI-generated. Nullable defensively (null if the stored content lacks text). |
| summary.key\_decisions | array of string | never (may be empty) | Explicit decisions made during the meeting, one string each. |
| action\_items | array of object | never (may be empty) | One entry per extracted action item, in no meaningful order (see the ordering note below). May arrive duplicated on a re-delivered event (§2.1). |
| action\_items\[\].description | string | yes (practically always set) | What is to be done. |
| action\_items\[\].owner | string | yes | Person responsible, as a **free-text name string** (not an email or ID) — may be an anonymous diarisation label such as "Speaker 0"; treat any value matching /^Speaker \\d+$/ as unattributed (§6, note 13). Null when unassigned. |
| action\_items\[\].due | string | yes | Due date **as stated in the meeting, free text** (e.g. "Friday", "June 15") — not a normalised ISO date. Null when none stated. |
| sent\_at | string (RFC 3339 timestamp) | never | When the webhook was dispatched. Format: RFC 3339 UTC with Z suffix and millisecond precision, e.g. 2026-07-18T15:05:12.345Z. **This format differs from started\_at.** |

**Timestamp formats differ.** started\_at (numeric-offset form, second precision) and sent\_at (Z form, millisecond precision) are produced by different machinery and are not interchangeable. Both are valid RFC 3339; use a full parser for each rather than one fixed format string or a Z\-suffix assumption.

**Ordering and identity.** participants and action\_items are unordered snapshots (read without an ORDER BY). Array position is not identity, and items carry no stable IDs or ordinals — do not diff by position across deliveries.

**Field shapes are requested, not runtime-validated.** The shapes above are requested from the model via a forced structured-output tool schema and then TypeScript-cast on our side without runtime validation; absent values are normalised to null at payload build time, and malformed stored JSON may be normalised to null or suppress the delivery entirely. Validate defensively on your side.

### 2.4 Complete example payload (fabricated data)

{  
  "event": "meeting.processed",  
  "meeting\_id": "3f9c2a71-8b44-4e02-9d5a-1c6e7b20f4aa",  
  "title": "Acme Widgets — discovery call",  
  "started\_at": "2026-07-18T14:00:00+00:00",  
  "status": "processed",  
  "meeting\_url": "https://meet.invalid/abc-defg-hij",  
  "participants": \["Jane Example", "Alex Sample", "Sam Placeholder"\],  
  "summary": {  
    "text": "Jane Example walked Alex Sample through the proposed onboarding workflow and the two open pricing questions. Alex confirmed the pilot scope of two teams and asked for a written proposal covering support hours. The group agreed the integration test environment would be ready within a week. Sam Placeholder raised a data-retention question that Jane will take away. The call closed with agreement to reconvene after the proposal is reviewed.",  
    "key\_decisions": \[  
      "Proceed with a two-team pilot",  
      "Reconvene after the written proposal is reviewed"  
    \]  
  },  
  "action\_items": \[  
    {  
      "description": "Send the written pilot proposal including support hours",  
      "owner": "Jane Example",  
      "due": "Friday"  
    },  
    {  
      "description": "Confirm the data-retention policy for recorded calls",  
      "owner": "Jane Example",  
      "due": **null**  
    },  
    {  
      "description": "Provide test-environment credentials to the pilot teams",  
      "owner": **null**,  
      "due": "next week"  
    }  
  \],  
  "sent\_at": "2026-07-18T15:05:12.345Z"  
}

The meeting\_url above deliberately uses the reserved non-routable .invalid TLD; live values are real Google Meet URLs in the format shown in §2.3.

### 2.5 What the webhook deliberately never contains

* **Coaching data** — the pipeline also produces private per-rep coaching assessments; these are access-controlled inside the CRM and are never included in any external payload.

* **Participant emails** — only display names are exposed.

* **Transcript text** — the full transcript is stored (see §4) but not pushed over this webhook. If ANDA needs transcript-level data, that is a scope conversation, not a config change (see §6, note 8).

### 2.6 Versioning and change policy

* **The payload carries no version field today.** event: "meeting.processed" identifies the event type only, not a schema revision. We intend to add an explicit schema\_version field early in this integration; it will arrive as an additive field under the rule below, and this document will be revised when the code actually emits it — do not build against it until then.

* **Compatibility contract:** we may add new top-level or nested fields without notice. Consumers must ignore unknown fields and must not use strict/closed schema validation. Removing a field, renaming one, or changing a type or nullability is a breaking change.

* **Breaking changes are announced in advance**, with notice agreed at the time, and will arrive as a new event value (e.g. meeting.processed.v2) or a new endpoint — never silently on the existing one.

* **Change notification contact:** the Elevateo side of this integration (Arnis), through the same channel this document arrived by.

---

## 3\. Upstream provenance (how the data is produced)

Useful context for understanding fidelity and edge cases; ANDA does not need to integrate at this layer.

1. A calendar watcher schedules an Attendee bot into Google Meet calls, carrying the event's title, start time, organiser and invitee emails as bot metadata (a guest bot cannot read these from Meet itself).

2. When the bot reaches a terminal state, the Attendee service POSTs a signed bot.state\_change webhook to the CRM. The CRM then pulls three things from the Attendee API: the bot object, the transcript, and the recording location.

3. The transcript arrives as an array of speaker turns:

{  
  "speaker\_name": string,  
  "speaker\_uuid": string,          // stable per person per meeting  
  "speaker\_is\_host": boolean,  
  "timestamp\_ms": number,  
  "duration\_ms": number,  
  "speaker\_user\_uuid": string|null, // optional  
  "transcription": { "words": \[ { "word": string, "punctuated\_word": string|null (may be absent),  
                                   "start": number, "end": number, "confidence": number } \] } | null  
}

This is the realtime (Attendee) word shape only — the fallback engines write differently-shaped word objects into the same table (see §4.3).

4. If the realtime transcript is empty, a fallback transcription chain runs (self-hosted Whisper primary; Deepgram pre-recorded as a keyed fallback, currently disabled). Fallback engines produce transcript segments but **no participant rows** — see §6, note 13\.

5. A content threshold applies: meetings whose transcript totals fewer than 40 words (configurable) are marked failed and **produce no summary and no outbound webhook**. Silent captures and bot-alone-in-room cases never reach ANDA.

6. The summary and action items are produced by an Anthropic Claude call with a forced structured-output tool schema — the shapes in §2.3 are **requested at generation time**, not parsed from prose; they are not runtime-validated afterwards (see the note under §2.3).

---

## 4\. Underlying stored records (the full data model)

Everything the pipeline stores, should a deeper integration (export, direct API) ever be scoped. Types are Postgres types; "null" means the column is nullable.

### 4.1 meetings — one row per captured meeting

| Column | Type | Nullable | Notes |
| :---- | :---- | :---- | :---- |
| id | uuid | no | Primary key. This is the meeting\_id in the webhook. |
| attendee\_bot\_id | text | no | Unique per capture (upsert key for idempotent ingest). |
| meeting\_url | text | no | Google Meet URL. |
| title | text | yes | From calendar metadata. |
| started\_at | timestamptz | yes | From calendar metadata. |
| ended\_at | timestamptz | yes | **Never populated by the current pipeline** — always null today. |
| organizer\_email | text | yes | From calendar metadata. |
| organizer\_contact\_id | uuid | yes | FK to CRM contacts. **Always null in the current ingest path** — no writer sets it today. |
| organizer\_user\_id | uuid | yes | FK to CRM user profiles. **Always null in the current ingest path** — organiser matching is deferred; the ingest writes an explicit null. |
| account\_id | uuid | yes | CRM account link, resolved conservatively from **calendar-metadata emails** (invited\_emails \+ organizer\_email) — not from meeting\_participants rows (ties resolve to null rather than guessing). |
| deal\_id | uuid | yes | CRM deal link; only set once an account resolves. |
| division\_id | uuid | no | Internal multi-tenancy scope. |
| recording\_bucket | text | no | Object-storage bucket (default meet-recordings). |
| recording\_object\_key | text | yes | Recording audio object key; null if the recording fetch failed. |
| summary | text | yes | The prose summary (same text as webhook summary.text). |
| client\_visible\_summary | boolean | no (default false) | Client-portal disclosure gate: when true, this meeting's summary may surface on the client portal. Defaults false — summaries are internal until staff opt them in. |
| status | enum | no | captured → processed or failed. (processing exists in the enum but is not written by the current pipeline.) |
| failure\_reason | enum | yes | Normally populated for new failures: transcription\_unavailable, no\_speech\_captured, or processing\_error. Also null for non-failures, for failures pre-dating migration 095, and on environments where 095 is unapplied (the writer degrades to a status-only update). **Do not infer "not failed" from a null here.** |
| invited\_emails | text\[\] | no (default empty) | Calendar invitee emails. |
| created\_at, updated\_at | timestamptz | no | Row timestamps. |

### 4.2 meeting\_participants — one row per detected speaker

| Column | Type | Nullable | Notes |
| :---- | :---- | :---- | :---- |
| id | uuid | no | Primary key. |
| meeting\_id | uuid | no | FK to meetings (cascade delete). |
| speaker\_uuid | text | no | Stable per person per meeting; unique with meeting\_id. |
| display\_name | text | no | As shown in Meet. |
| email | text | yes | Schema slot for a matched email — **the current pipeline never fills it; always null today.** |
| contact\_id | uuid | yes | Schema slot for a matched CRM contact — **never filled by the current pipeline; always null today.** |
| user\_id | uuid | yes | Schema slot for a matched internal team member — **never filled by the current pipeline; always null today.** |
| is\_host | boolean | no | From the transcript payload. |

### 4.3 transcript\_segments — one row per retained speech turn

| Column | Type | Nullable | Notes |
| :---- | :---- | :---- | :---- |
| id | uuid | no | Primary key. |
| meeting\_id | uuid | no | FK to meetings (cascade delete). |
| participant\_id | uuid | yes | Link to the speaker's participant row (null only if unmatched). |
| speaker\_name | text | no | Denormalised display name. |
| started\_at\_ms | bigint | no | Millisecond timestamp of the turn (see §6, note 5 on semantics). |
| duration\_ms | int | no | Turn duration in milliseconds. |
| text | text | no | Punctuated words joined into the turn's text. |
| words | jsonb | yes | Raw word-level array, stored as received from whichever engine transcribed the meeting — the shape is a **union**: realtime (Attendee) words are {word, punctuated\_word, start, end, confidence} with punctuated\_word optional/null; Whisper words omit punctuated\_word entirely; Deepgram words may additionally carry a numeric speaker. start/end are seconds for the fallback engines; the realtime engine's units are not pinned in code. May be null. |
| seq | int | no | Zero-based turn order **among retained rows** within the meeting (unique with meeting\_id) — not the upstream array index; see the filtering note below. |
| created\_at | timestamptz | no | Row timestamp. |

Only speech turns containing at least one transcribed word become rows — partial upstream entries with zero words are silently dropped, and seq renumbers the retained rows only. Partial word arrays are stored as received; there is no completeness or finality indicator on a segment.

### 4.4 meeting\_insights — AI outputs, one row per insight

| Column | Type | Nullable | Notes |
| :---- | :---- | :---- | :---- |
| id | uuid | no | Primary key. |
| meeting\_id | uuid | no | FK to meetings (cascade delete). |
| kind | enum | no | summary, action\_item, deal\_signal, talk\_metric, coaching. |
| content | jsonb | no | Shape varies per kind — see below. |
| coaching\_rep\_user\_id | uuid | yes | FK to internal user profiles. RLS-scopes the private coaching row to its rep. Written only on kind='coaching' rows; null on all other kinds, and null on coaching rows whose rep has no CRM profile mapping. |
| created\_at | timestamptz | no | Row timestamp. |

Content shapes per kind, as written by the current pipeline:

* summary — { "text": string, "key\_decisions": string\[\] }. Written once per pipeline run — a re-run (see §2.1 re-delivery) appends another row; no uniqueness is enforced, and the webhook picks arbitrarily when more than one exists.

* action\_item — { "description": string, "owner": string|null, "due": string|null } (one row per item; a pipeline re-run appends a second full set).

* coaching — private per-rep assessment; access-controlled via coaching\_rep\_user\_id, **never exported**. Stored shape, for completeness: { "rep\_name": string, "rep\_email": string|null, "call\_type": "sales"|"delivery"|"internal"|"other", "strengths": string\[\], "dimensions": \[{ "key": string, "score": number, "evidence": string }\], "overall\_score": number, "fixes": \[{ "action": string, "example\_phrasing": string, "by\_when": string }\], "prep\_nudge": string }.

* deal\_signal, talk\_metric — **defined in the schema but nothing writes them today** (reserved).

---

## 5\. Other emission channels (for completeness)

* **Summary email** — after processing, a notes email (summary \+ action items, never coaching) is sent to meeting invitees. Human-facing, not a machine interface.

* **Internal Telegram notification** — internal ops channel, not an integration surface.

* **CRM UI/API** — meetings, transcripts and insights render inside the CRM behind per-user row-level security. No public API is exposed today.

ANDA should treat the §2 webhook as the sole machine-readable interface currently offered.

---

## 6\. Honest notes: ambiguities and limitations in the current code

1. **action\_items\[\].due is free text**, verbatim from the conversation ("Friday", "June 15"), not a normalised date. ANDA must not parse it as ISO 8601\.

2. **owner is a free-text name string**, not an identifier — and on fallback-transcribed meetings it may be an anonymous diarisation label (note 13). Cross-referencing owners to people is on the consumer.

3. **ended\_at is never set** by the current pipeline; meeting duration is only recoverable from transcript segment timings.

4. **deal\_signal and talk\_metric insight kinds are reserved but unwritten** — do not build against them.

5. **Transcript timestamp semantics are not pinned down in code**: started\_at\_ms carries the Attendee transcript's timestamp\_ms as-is, and the code never documents (or relies on) whether that is an epoch timestamp or an offset from recording start. If ANDA ever consumes transcript-level data, this needs one empirical check first.

6. **The outbound webhook supports exactly one consumer URL** (single server-side setting). Adding ANDA alongside any existing consumer would need a small change on our side.

7. **No retries, no replay, no poll endpoint**: a missed delivery (consumer downtime) is currently unrecoverable by the consumer. If ANDA needs guaranteed delivery, ask us — it is a build item, not a toggle.

8. **The webhook carries summary-level data only.** Transcripts, participant emails, recordings and CRM links are stored (§4) but not pushed. Any of those crossing the wire to ANDA is a scope \+ privacy conversation.

9. **Quiet meetings emit nothing**: below the \~40-word transcript threshold the meeting is marked failed and no webhook fires. ANDA should not expect an event for every calendar entry.

10. **No replay protection** in the signature scheme (no timestamp in the signed material) — dedupe on meeting\_id.

11. **One rare race can fire the webhook for a failed meeting**: if the transcript rows vanish between the content-threshold check and summarisation (a pipeline inconsistency, not "nobody spoke"), the meeting is marked failed without an exception being thrown, and the webhook still fires — with status: "failed", summary: null and action\_items: \[\]. Validate status and treat non-processed events as ignorable. The webhook's precondition is otherwise simple: it fires whenever summarisation returns without throwing. The internal coaching step that runs before delivery is fail-open — coaching failures are logged and contained, and cannot suppress the event or change an already-processed meeting.

12. **participants is a speaker roster, not an attendance list.** It is built from detected speakers only, then filtered by a display-name heuristic — the exact rule is: names matching /notetaker|fireflies|\\bbot\\b/i are removed. Both failure directions exist: an unrecognised bot (including one presenting under the capture platform's own product name) can be retained as if human, and a real person whose display name matches can be dropped — "Bot" is an attested surname. Duplicate display names can occur (two speakers sharing a name are indistinguishable), names are not identifiers, and no join/leave/rejoin, duration or presence-interval data is emitted. Do not treat participants as an authoritative attendee list.

13. **Speaker identity comes from the realtime capture path only.** When a meeting is transcribed by the fallback engine, participants is \[\] and action\_items\[\].owner is null or an anonymous diarisation label such as "Speaker 0". Treat any owner matching /^Speaker \\d+$/ as unattributed, and do not assume an empty participants array means a one-person meeting. Fallback transcription is routine, not exotic — a meaningful slice of traffic arrives this way.

14. **Output language is not guaranteed.** Summary and action-item text is produced by an English-prompted model with no language pinning or detection; for non-English meetings the output language is model-dependent and not guaranteed to match the source. There is no language field in the payload. Do not assume a fixed language per field.

---

## 7\. Recommendations (advisory — not part of the integration contract)

*Section provenance: added as a follow-on round on Arnis's 19:38 instruction of 2026-07-18, relayed via the concierge (wake5). Everything in this section is a recommendation or an open offer to ANDA — not a change to the contract described in §§1–6, and not a commitment to build or host anything.*

### 7.1 Capturing Microsoft Teams meetings on ANDA's side

This document describes our Google Meet capture. ANDA's own meetings run on Microsoft Teams, so an equivalent capability on ANDA's side needs one of the options below. All open-source project facts were verified by web search on 2026-07-18; release states move, so re-verify before committing. We judge projects on licence and maintenance, not popularity metrics.

**Option A — port our stack.** The honest split, from the same code this document was extracted from:

* Genuinely portable (no Google coupling anywhere): the bot-webhook ingress and signature verification, transcript and recording fetch, the transcript-segment builder, the fallback transcription chain (self-hosted Whisper, optional Deepgram), the summariser, and the outbound meeting.processed webhook — roughly two-thirds of the pipeline. None of it branches on the meeting platform.

* Google-coupled, and would need rewriting in full: the calendar layer. Both of our schedulers (a polling watcher and a real-time push receiver) are Google Calendar API code end to end — the auth model, the event schema, and the push-notification mechanism are all Google-proprietary. A Teams equivalent is a new service against Microsoft Graph (Azure AD app registration, admin consent, a different subscription and renewal model), not a configuration swap. One optional Google-specific settings block in the bot-creation call would also need replacing with its Teams equivalent.

* The capture engine underneath is the open-source **Attendee** project (attendee-labs/attendee, MIT licence), which we self-host. Upstream Attendee supports Microsoft Teams bots in production (implemented as Chrome-based browser automation, like its Meet integration), so the bot layer itself is not the blocker.

* The honest cost: our pipeline was built as a CRM feature. The CRM-matching layers are optional and cleanly skippable (they are fail-open in our own code), but a standalone port still means ANDA operating an Attendee deployment (Docker, Postgres, Redis, S3-compatible object storage), a transcription fallback, and the new Microsoft Graph calendar service. That is a real operational estate for one capability, and Teams/Graph operational behaviour (tenant consent, lobby and bot-join policies, subscription renewal) is territory neither side has prior art in.

**Option B — Meetily** (Zackriya-Solutions/meetily, MIT; previously published under the name meeting-minutes). A local-first open-source notetaker: a desktop app (Windows and macOS installers; Linux builds from source) captures system audio on the user's own machine — no bot joins the call — so it works with Teams, and with any other platform, without touching any meeting-platform API. Transcription runs locally (Whisper.cpp or Parakeet), storage is local (SQLite), and summarisation uses either a local model via Ollama or an external API key ANDA controls. Verified state as of 2026-07-18: MIT licence (consistently stated across the repository and project site, though we did not read the licence file byte-for-byte); issue tracker active into July 2026; latest tagged release v0.3.0 (March 2026), while the project site advertises a 0.4.0 community release (June 2026\) with no matching tag we could find — check the releases page before adopting a version number. The structural caveats: capture is per machine (a participant's computer must be in the call with the app running), and there is no server-side API or webhook surface — it is a personal capture tool, not an unattended pipeline like the one this document describes.

**Option C — Vexa** (Vexa-ai/vexa, Apache-2.0 as stated by the vendor) is the one other credible name: a self-hostable meeting-bot API (Docker/Kubernetes) whose v0.6 release added Microsoft Teams support (the bot joins via the Teams web client), exposing live transcripts over REST/WebSocket. Reasonably active as of mid-2026. Architecturally the same category as Attendee; we have no operational experience with it.

We also checked our internal resource library for anything else applicable to Teams-side capture; nothing beyond the options above surfaced.

**Recommendation.** Start with **Meetily**. For capture on ANDA's own side with minimal moving parts, it is the fastest and cheapest credible path: MIT-licensed, actively maintained, no meeting-bot infrastructure to run, no Teams API surface to break, and full data locality by construction. Its boundary is the capture model: if ANDA needs *unattended, calendar-driven* capture producing a machine-readable feed (the shape our own tool has), Meetily will not stretch there — at that point self-hosting **Attendee** is the better fit, and the strongest argument for it is that it is the engine we already operate, so our operational experience (§3 and the quirks behind it) transfers directly.

### 7.2 Hosting ANDA's capture service

Relevant only if ANDA adopts a server-side option (Attendee or Vexa — Meetily's core needs no server). Two routes are on the table; neither is committed beyond the open offer stated below, and neither changes anything in §§1–6.

* **Railway, or a similar managed platform.** Fastest to stand up; ANDA owns the deployment, billing and operations end to end, with no dependency on us. Trade-offs: usage-based cost for always-on services — bot-based capture runs a browser instance per concurrent meeting, so cost scales with meeting concurrency, and idle services still bill; and the data sits with a third-party cloud, whose region and data-processor status are ANDA's to assess.

* **Space on our VPS estate — this offer stands (Arnis).** We already operate exactly this class of workload (a self-hosted Attendee deployment plus Whisper transcription), so provisioning and running it is known territory on our side, on flat-cost hardware. The trade-offs to be honest about: ANDA's meeting content would live on Elevateo-operated infrastructure, which both sides need to be comfortable with (a simple data-processing understanding would be sensible); operational ownership — patching, monitoring, who responds when it breaks — must be agreed explicitly rather than assumed; and the space would be provisioned as a dedicated, isolated instance, not co-tenancy with our CRM data. Specifics (sizing, access, cost basis) are deliberately not committed here and would be agreed if the offer is taken up.

### 7.3 Planned hardening of our capture tool (context, not commitment)

Independent of ANDA, an internal review of the capture tool (same date as this document) produced a short hardening list. It is tracked on our internal work queue for scheduling after current restoration work completes; none of it carries a date or a commitment, but several items would directly soften the caveats in §6, so ANDA should know they are on the board. Coarse sizes: S \= hours, M \= days.

| Item | What it addresses | Size | Effect on this spec if done |
| :---- | :---- | :---- | :---- |
| Re-delivery idempotency (honour the existing idempotency key; stop duplicate insight rows on pipeline re-runs) | The §2.1 re-delivery duplication | M | Duplicated action\_items and the non-deterministic summary pick disappear; the mandatory keep-first dedupe on meeting\_id remains regardless |
| Runtime validation at the model boundary and before delivery | The §2.3 "requested, not runtime-validated" caveat | M | Payload shapes become guaranteed rather than requested |
| Outbound payload byte cap | The §2.1 unbounded-size note | S | A stated maximum payload size ANDA can size ingress against |
| schema\_version: 1 field in the payload (additive) | The §2.6 missing version field — worth landing before ANDA builds | S | §2.6 and this document revised when the code actually emits it |
| Bot-name filter unification across the two code paths that apply it | One source of §6 note 12's filter quirks | S | Consistent participant filtering |
| Two stale internal code comments corrected | Future extraction accuracy only | S | None visible to ANDA |

The version field, validation and byte-cap items would naturally ship together. If ANDA's build timeline is sensitive to any of these — the schema\_version field especially — say so through the usual channel and we will weigh the sequencing.

---

*Extraction sources: the CRM's Attendee webhook route, signature verifier, attendee API types, transcript-segment builder, post-ingest pipeline, summariser, outbound notify module, matcher/enrichment modules, and database migrations 015/021/055/063/095 — all read directly from the repository on 2026-07-18.*
