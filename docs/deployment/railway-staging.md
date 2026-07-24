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

ANDA_ENVIRONMENT=staging
ANDA_STAGING_ACTOR_PROFILE_ID=10000000-0000-4000-8000-000000000006

OPENAI_API_KEY=REPLACE_ME
OPENAI_MODEL=gpt-5.6-terra

FIRMA_API_KEY=REPLACE_ME
FIRMA_WEBHOOK_SECRET=REPLACE_ME
SIGNING_TEST_SIGNER_FIRST_NAME=REPLACE_ME
SIGNING_TEST_SIGNER_LAST_NAME=REPLACE_ME
SIGNING_TEST_SIGNER_EMAIL=REPLACE_ME
```

`SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `FIRMA_API_KEY`, and
`FIRMA_WEBHOOK_SECRET` are server-only secrets. Do not prefix them with
`NEXT_PUBLIC_`.

The fixed staging actor is John Smith. The hosted database must contain the
active John Smith profile with UUID
`10000000-0000-4000-8000-000000000006` and role `TREASURER` before the UI can
read, review, approve, or send meetings for signing. This temporary identity is
accepted only when both `NODE_ENV=production` and
`ANDA_ENVIRONMENT=staging`; other production environments fail closed.

## Hosted Supabase

Apply every committed migration to the staging Supabase project in filename
order. Seed the required John Smith staging profile separately after migrations
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
3. Enter a title, date, duration, and speaker-labelled transcript.
4. Select **Begin processing** and wait for the meeting to reach
   `PENDING_APPROVAL`.
5. Review and edit minutes, attendance, and motions.
6. Approve the minutes and open the generated Firma signing request.
7. Sign the document and confirm the Firma callback moves it through archive to
   `COMPLETED`.

Transcript participants do not need pre-seeded profiles. Each detected speaker
is stored as an unlinked meeting attendee and remains available to AI, motions,
votes, and human review. A future matching profile can link to that attendee,
but a missing profile does not block processing.

## Not required for this client test

- Docker Desktop on the deployed environment
- A deployed Supabase container
- Read AI webhook variables
- `NEXT_PUBLIC_SUPABASE_URL` or a browser Supabase key
- Telegram variables
- Operations scheduler variables
- Cloudflared variables
- `FIRMA_WORKSPACE_ID` (used by the local live-test helper, not the app runtime)
