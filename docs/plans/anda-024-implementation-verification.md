# ANDA-024 implementation verification

Work item: [GitLab #29](https://gitlab.com/elevateo-group/anda-dashboard-dev/-/work_items/29)
Branch: `29-anda-024-staging-accounts-role-permissions-draft-discard`
Verified: 3 October 2026

Individual Supabase email/password sign-in replaces the shared master gate and
fixed actor. Protected requests verify the Auth user and load their active member
profile. USER can view, upload, edit and prepare drafts; OFFICER adds approval and
discard; TREASURER adds signing and signing outcome actions. API and database
guards enforce those permissions. Account administration and transfer UI are
removed; historical database roles and signature records remain intact.

Discard is an atomic, version-checked transition for unapproved `AI_FAILED` or
`PENDING_APPROVAL` records, including deferred drafts. It hides the record from
application lists, queues, counts, detail and search, retains its evidence and
audit entry, and freezes subsequent writes. There is no dashboard restore flow.

New Firma requests freeze the Treasurer's profile ID, explicit signing first and
last name, and email before delivery. Retries and verified completion use this
snapshot, preserving attribution if account roles subsequently change. Legacy
envelopes without a snapshot require operator verification before resuming.

## Automated verification

| Check | Result |
| --- | --- |
| `npm.cmd run check` | Passed lint, TypeScript, unit suite and production build. 448 tests passed, 47 skipped, 3 existing TODOs after account replacement. |
| `npm.cmd run test:integration` | All 38 tests in 13 suites passed against local Supabase, with a fake signing provider. |
| `npm.cmd run test:api:http` | Passed actual HTTP unauthenticated denial, Officer sign-in, authenticated list/search and invalid request handling. |
| All SQL migrations replayed in filename order | Passed in a separate temporary database with local Auth/Storage bootstrap; temporary database removed afterward. |
| Upgrade of existing local database | Four new migrations applied without resetting existing application data; migration ledger updated. |
| `tests/sql/anda-024-recipient-snapshot.sql` | Passed recipient immutability and original signer/history attribution after a temporary role replacement; transaction rolled back. |

The account integration tests also exercise real Auth login/logout, expired SSR
cookie refresh, HttpOnly cookie writes, inactive account denial, raw authenticated
profile/RPC escalation denial, member drafting, Officer version conflict/discard
and retained immutable evidence. Live OpenAI tests remain opt-in; the full check
ran with `OPENAI_API_KEY` cleared in its child process. No real Firma document was
signed as part of this verification.

Independent test servers and the build use isolated `.next-*` directories so they
do not corrupt the development server's `.next` output. `ANDA_NEXT_DIST_DIR` is an
optional local/test setting; normal development and deployment keep `.next`.

## Browser verification on localhost:3000

The initial browser pass used seeded development identities. Their local login
addresses and display names were then replaced at the user's request with
James Wilson USER (`james.wilson@example.com`), Ernesto OFFICER
(`ernesto@example.com`) and Richard TREASURER (`richard@example.com`). All use
`local-only-password`; Auth accounts are confirmed and no email is sent. Old login
addresses are rejected and old refresh sessions revoked. Existing profile IDs,
meeting history and frozen signing snapshots are retained. Seed and fixture
data use the replacement identities on future local resets. Richard's local-only
signing name is Richard Smith; the real staging signing name remains pending.
These are development fixtures, not the client's staging accounts.

- USER signed in, edited and saved minutes, then marked an AI-failed draft ready.
  The result was pending approval; approval and discard controls were absent.
- OFFICER opened approval and cancelled it, opened/cancelled discard, deferred
  a disposable draft, then discarded it. The record disappeared from All meetings
  and an exact-title search returned no matching records.
- TREASURER discarded a separate AI-failed disposable draft successfully.
- TREASURER saw signing, correction and status controls for an awaiting-signature
  fake-provider fixture. OFFICER viewed an awaiting-signature record without those
  controls. No signature or external signing delivery was submitted through UI.
- Account switches used real sign-out/sign-in and displayed the appropriate
  account name and role. Account administration navigation was absent.

Local screenshots are retained in ignored `output/anda-024/`:
`officer-draft-controls.jpg`, `officer-discard-search.jpg`,
`treasurer-signing-controls.jpg`, and `officer-signing-readonly.jpg`.
The replacement logins were also verified through UI and captured in
`ernesto-officer-login.jpg`, `richard-treasurer-login.jpg` and
`james-user-login.jpg`.
The member-prepared disposable draft remains available for local review at
`/app/meetings/24002400-0000-4000-8000-000000000001`.

The integration command runs files sequentially: account tests temporarily
deactivate a shared seeded profile, and recovery tests scan shared workflow
state. Running those files concurrently interferes with other fixtures.
The broader check also found that an empty Read AI normalization placeholder
discarded otherwise valid source timestamps and participants. The mapper now
ignores the absent summary while retaining provenance, with regression coverage.

## Migrations and staging handoff

Apply these additive migrations in order through the established release process:

1. `20261003100000_simplify_account_access.sql`: explicit signing names, authenticated
   table write restriction, simplified review/approval permissions and transfer
   RPC restriction; trusted service-role access retained.
2. `20261003100100_add_discard_history_action.sql`: separate committed enum addition.
3. `20261003100200_add_draft_discard.sql`: discard metadata, atomic RPC, frozen
   evidence and application read/queue filtering.
4. `20261003100300_bind_signing_requests_to_treasurer.sql`: immutable recipient
   snapshot, delivery/session/outcome guards and original signer attribution.

On 3 October 2026, implementation commit `36f229b` was pushed to GitLab, merged
normally into development (`5cf4f1a`) and pushed to GitLab and the existing
`callum-matrix-automations/anda-dashboard-dev` GitHub mirror. Development was
merged normally into GitLab staging (`00bb601`), preserving the ancestry of the
Railway proxy fix. Its obsolete shared-login changes were resolved to the tested
account implementation with public `APP_ORIGIN` validation. The resulting
application tree matched development exactly.

Supabase project `huogkdcopyitjvpftdnl` had a completed managed physical backup
from 3 October at 07:55 UTC. A private schema backup was also saved locally.
Automatic approval review rejected a full local data export because it would
copy private association and Auth data; the managed backup was verified instead.
The four additive migrations were applied without a reset and verified in the
remote migration ledger. All seven existing meetings and four existing signing
requests remain present. All four legacy requests lack recipient snapshots and
remain protected pending manual verification; no historical recipient or signer
was reassigned. Supabase CLI reported a non-fatal catalog-cache warning after
successful migration application; the remote ledger and new columns were
independently verified.

Ernesto OFFICER (`ernesto@example.com`) and James Wilson USER
(`james.wilson@example.com`) were manually provisioned as confirmed staging test
accounts and their Supabase Auth logins verified. No invitation was sent.
Temporary credentials are stored only in ignored
`output/anda-024/staging-test-credentials.private.json`. These are made-up test
addresses authorised by the user. The pre-existing Treasurer login was preserved
pending the user's choice about replacement with Richard; its signing names are
not yet configured. No local seed was applied to hosted staging.

The GitHub deployment branch remains at `5c46209` while Railway browser sign-in
is pending. Before pushing GitHub staging, set `SUPABASE_PUBLISHABLE_KEY` and the
public HTTPS `APP_ORIGIN` through
[the Railway staging cutover instructions](../deployment/railway-staging.md),
finish the staging Treasurer setup, and then verify the actual deployed SHA and
hosted account/role UI. Retire unused shared-master, fixed-actor and test-signer
variables after cutover. Client-confirmed production addresses and Richard's
real signing name remain pending; no real Firma signing test has been performed.
