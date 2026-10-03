# Railway staging deployment

This staging deployment is for client testing through the manual **Upload
transcript** flow. Read AI webhook intake, Telegram alerts, and scheduled
recovery are not required for that test.

## Runtime

Railway should deploy the `staging` branch from the repository root. The root
`Dockerfile` builds the standalone Next.js server and includes the `public`
assets. Railway performs this container build; Docker Desktop is not required
on the deployed service.

Generate a public Railway domain and use the default application port supplied
through `PORT`. The container already binds to `0.0.0.0`.

## Required Railway variables

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_ME
SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
APP_ORIGIN=https://YOUR-RAILWAY-DOMAIN

OPENAI_API_KEY=REPLACE_ME
OPENAI_MODEL=gpt-5.6-terra
OPENAI_TRANSCRIPT_NORMALIZATION_MODEL=gpt-6-luna

FIRMA_API_KEY=REPLACE_ME
FIRMA_WEBHOOK_SECRET=REPLACE_ME
```

`SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `FIRMA_API_KEY`, and
`FIRMA_WEBHOOK_SECRET` are server-only secrets. Do not prefix them with
`NEXT_PUBLIC_` or commit their real values.

Testers sign in with their individual Supabase email/password account. The server
verifies Auth and loads the active `MEMBER` profile on every protected request.
Hosted cookies are HttpOnly, Secure and SameSite=Lax. Set `APP_ORIGIN` to the exact
public HTTPS origin so mutation requests work behind Railway's proxy.

The dashboard and browser-facing APIs require an active account. Read AI and
Firma webhooks retain their signature checks; internal recovery/analysis routes
retain their independent bearer secrets. There is no shared master-login bypass.

## ANDA-024 account and migration cutover

1. Back up the staging database and apply all migrations in filename order,
   including the four `20261003100...` migrations. Keep the discard enum addition
   as its own committed migration before applying the discard function.
2. Create Ernesto's Auth user and active `MEMBER/OFFICER` profile; create Richard's
   Auth user and active `MEMBER/TREASURER` profile. Use client-confirmed email
   addresses. Richard requires explicit `signing_first_name`, `signing_last_name`
   and profile email for Firma. Passwords are manually issued for this milestone.
   If an old dummy Treasurer is active, resolve that profile manually first: the
   database permits only one active Treasurer. Do not alter old signature history.
3. Operator setup can use `node --env-file=.env.staging scripts/provision-account.mjs
   --email EMAIL --name "DISPLAY NAME" --role OFFICER`. Set a temporary
   `ANDA_ACCOUNT_PASSWORD` environment variable (12+ characters) beforehand.
   Treasurer additionally takes `--first-name` and `--last-name`. This creates a
   confirmed Auth account without sending an invitation. Share credentials
   privately, then clear the temporary password variable.
4. Set `SUPABASE_PUBLISHABLE_KEY` and `APP_ORIGIN` in Railway and release this
   branch through the normal development-to-staging process. No container or
   private storage changes are required.
5. Verify member upload/edit/prepare, officer approval/discard, Treasurer signing,
   sign-out, session refresh and inactive-account denial against staging.
6. Retire `MASTER_AUTH_USERNAME`, `MASTER_AUTH_PASSWORD`,
   `ANDA_DEV_ACTOR_PROFILE_ID`, `ANDA_STAGING_ACTOR_PROFILE_ID`, and application
   `SIGNING_TEST_SIGNER_*` settings. The new runtime never uses these fallbacks.

New signing requests capture the Treasurer profile ID, explicit first/last name
and email before any provider call. Delivery retries and outcomes use that frozen
recipient. Existing provider envelopes with no snapshot are held for manual
verification; do not automatically assign them to Richard. Preserve completed
records' original `signed_by`, signature evidence and audit history. For a legacy
pending envelope, confirm its PDF/version, provider reference, actual recipient
and historical profile before an operator backfills the four recipient snapshot
columns. Do not send a replacement envelope just to bypass this verification.

The release adds soft discard for unapproved `AI_FAILED` and `PENDING_APPROVAL`
records, including deferred drafts. Discarded records leave lists/detail/search;
their source evidence and history remain frozen. There is no restore/trash UI.
Production registration, invitation, password recovery and account administration
remain outside this milestone. Client production provisioning is still undecided.

## Hosted Supabase

Apply every committed migration to the staging Supabase project in filename
order. Provision the client-confirmed accounts separately after migrations
have been applied. The local `supabase/seed.sql` is a development fixture and
must not be applied wholesale to a client database unless all of its dummy
profiles are intentionally wanted.

The application accepts Supabase's current opaque `sb_secret_...` key. It sends
that key only through the `apikey` header. Legacy local/service-role JWT keys
remain supported for local development.

## Firma callback

In the Firma workspace webhook settings, create an endpoint using the final
Railway domain:

```text
https://YOUR-RAILWAY-DOMAIN/api/webhooks/firma
```

Use the same webhook signing secret in Firma and
`FIRMA_WEBHOOK_SECRET`. Subscribe to the signing-request lifecycle events used
by the workspace. Send Firma's webhook test delivery and confirm the endpoint
returns a successful response before the client test.

Redeploy if the Railway domain or any build-time variable changes.

## Client test path

1. Open the Railway application.
2. Select **Upload transcript**.
3. Enter a title, date, duration, and readable plain-text transcript. Common
   speaker-labelled, timestamp-block, timestamped-line, SRT, and WebVTT formats
   are handled directly. Other readable text formats use GPT-6 Luna only to
   identify speaker turns before the existing minutes analysis begins.
4. Select **Begin processing** and wait for the meeting to reach
   `PENDING_APPROVAL`.
5. Review and edit minutes, attendance, and motions.
6. As Officer or Treasurer, approve the minutes. As Treasurer, open the generated Firma signing request.
7. Sign the document and confirm the Firma callback moves it through archive to
   `COMPLETED`.

Transcript participants do not need pre-seeded profiles. Each detected speaker
is stored as an unlinked meeting attendee and remains available to AI, motions,
votes, and human review. A future matching profile can link to that attendee,
but a missing profile does not block processing.

The upload dialog shows a transcript check before processing. Generic speakers,
possible aliases, and low attribution coverage remain visible for human review.
The original transcript is immutable. A separate versioned normalization audit
record stores the canonical speaker-labelled input, hashes, warnings, method,
and model identifiers. Luna output is rejected if its dialogue cannot be traced
verbatim to the source transcript.

While a manual meeting is still untouched and awaiting review (or has failed
analysis), authorised reviewers can use **Re-check transcript** from the source
panel. This creates a new immutable normalization version and reruns analysis;
it is disabled after a human edit, deferral, or approval so reviewed minutes
cannot be silently replaced.

## Not required for this client test

- Docker Desktop on the deployed environment
- A deployed Supabase container
- Read AI webhook variables
- `NEXT_PUBLIC_SUPABASE_URL` or a browser Supabase key
- Telegram variables
- Operations scheduler variables
- Cloudflared variables
- `FIRMA_WORKSPACE_ID` (used by the local live-test helper, not the app runtime)
