# Staging accounts and draft discard implementation plan

Work item: [ANDA-024 GitLab work item 29](https://gitlab.com/elevateo-group/anda-dashboard-dev/-/work_items/29)
Date: 3 October 2026
Branch: `29-anda-024-staging-accounts-role-permissions-draft-discard`
Reviewed baseline: `77f591d`
Status: implemented and verified locally on this branch. The four migrations have been applied to local Supabase; hosted staging configuration and client accounts remain pending. See [implementation verification](anda-024-implementation-verification.md).

Implement individual email/password accounts through the existing Supabase project, use User, Officer and Treasurer permissions, and let Officers and the Treasurer discard unwanted drafts. Preserve the existing approval, PDF, Firma and archive workflow. Create Ernesto and Richard manually for staging; leave future account setup to the client's decision.

## Agreed behaviour

| Action | User | Officer | Treasurer |
| --- | --- | --- | --- |
| View meetings, minutes, transcripts and signed archive | Yes | Yes | Yes |
| Upload transcripts and edit drafts | Yes | Yes | Yes |
| Defer, resume and prepare drafts using existing recovery actions | Yes | Yes | Yes |
| Approve minutes and retry failed PDF generation | No | Yes | Yes |
| Retry failed signing delivery | No | Yes | Yes |
| Discard eligible drafts | No | Yes | Yes |
| Open the signing link, sign, reject and retry signing outcome actions | No | No | Yes |

Lifecycle checks still apply. Everyone means an active signed-in account. Ernesto receives OFFICER and Richard receives TREASURER; no permission code depends on either person's name, email or UUID.

Discard retains evidence and history while removing a draft from ordinary queues, search and counts. It is not permanent deletion. There is no trash or restore interface in this milestone.

Microsoft OAuth, registration, invitations, account administration, Superadmin, admin flags, configurable permissions and Treasurer transfer screens are excluded. The current Property Centre and Financial Records permissions remain as they are, but use the authenticated account rather than a fixed actor.

## Findings at the reviewed baseline

- `src/middleware.ts`, `src/backend/auth/masterSession.ts` and the auth routes use one shared master cookie. It does not identify an individual ANDA profile.
- `src/backend/auth/serverActor.ts` ignores the request identity and loads the configured development or staging profile. Its review permission bundles editing, approval and PDF retries together.
- `public.profiles.id` already references `auth.users.id`. Existing columns include normalized email, display name, account status and USER/OFFICER/TREASURER roles. A partial unique index permits at most one active Treasurer.
- `meeting_review_actor_can_edit` currently excludes USER. Upload checks, API capabilities and SQL review/recovery functions therefore need coordinated changes.
- The approval/PDF implementation is already delivered under ANDA-007.1. Some privileged approval RPCs currently verify only that an actor profile exists. Keep their workflow logic and strengthen their active-role checks when connecting real sessions.
- The database has broad authenticated table-write grants and account-manager policies from the older account design. Individual Supabase accounts make those direct access paths relevant even though the UI uses Next.js APIs.
- Signing delivery, signing-link lookup and callback outcome verification use `SIGNING_TEST_SIGNER_*`. Completion currently selects the current active Treasurer instead of a recipient profile saved on the signing request.
- No meeting-level discard operation exists. Deferral is separate metadata and is not draft removal.
- On inspection, GitLab development is `77f591d`, GitLab staging is `d9a098e`, and the Railway-facing GitHub staging branch is `5c46209`. That last commit fixes login behind the Railway proxy. Preserve the behaviour when merging the new auth implementation.

These findings come from the current source, migrations and remote branch references. Hosted Supabase records, Auth settings, applied migrations and Railway variables were not audited live; confirm them during staging preflight.

## Implementation sequence

### 1 Implement individual sessions

Use Supabase Auth email/password authentication as the proposed implementation choice. It reuses the existing auth/users-to-profile relationship and avoids building another password store.

Add `@supabase/supabase-js` and `@supabase/ssr` with compatible versions selected during implementation. Keep authentication server-side; browser components continue to call the typed Next.js API client. No browser Supabase client is needed.

Update login/logout handlers and sign-in UI to email/password. Create a request-scoped server client, validate identity with `auth.getUser()`, and look up an ACTIVE MEMBER profile whose ID equals the verified user ID. Reject absent or inactive profiles; do not take roles from editable Auth metadata, request headers or request bodies. Do not use a globally shared user client or authorize using an unverified `getSession()` result. Supabase documents server cookie integration and verified user lookup in its [Next.js SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) and [getUser reference](https://supabase.com/docs/reference/javascript/auth-getuser).

Keep `src/middleware.ts`: this app is on Next.js 15, so copying a Next.js 16 `proxy.ts` example would break refresh. Use the cookie bridge to propagate refresh writes to the incoming request and outgoing response, including redirects and errors. Because this design has no browser auth client, configure cookies as HttpOnly, Secure on hosted HTTPS, SameSite=Lax and Path=/. Keep authenticated responses private and uncached. Use logout scope local and clear all current/legacy auth cookies. Refresh and cookie handling must be tested with concurrent requests. The server-only HttpOnly choice is an application adaptation of the SSR guidance, whose default examples also support browser clients.

Retain the existing modest login rate limit and safe return URL handling. For browser mutations, use the configured public application origin rather than comparing Origin with a proxy-rewritten request URL. Add `APP_ORIGIN` for this check. Preserve JSON requests and support the existing logout form. Confirm real Railway login/logout works before cutover.

Expose `GET /api/auth/me` with profile ID, display name, role and safe capabilities. It must authenticate itself even if middleware exempts the auth route prefix. Preserve the separate authentication of `/api/webhooks/*` and `/api/internal/*`.

### 2 Separate edit, approve, discard and sign permissions

Replace the bundled review gate with explicit draft-edit, approve, discard, signing-delivery-retry and Treasurer-signing permissions. Apply them through `apiResponses.ts`, `meetingApiHandlers.ts`, upload handlers, review/approval/signing services and the database functions.

Allow all active member roles to edit and prepare drafts. Restrict approval, PDF retry, delivery retry and discard to OFFICER/TREASURER. Signing-session access, rejection, provider status checks and outcome retries remain TREASURER-only. In particular, the current signing-delivery retry is Treasurer-only in both capabilities and SQL; change that one operation without broadening signing-link access.

Always populate actorProfileId from the verified account at the controller/service boundary. Keep existing version conflicts, human ownership, deferral, approval snapshots and unresolved-vote acknowledgement. Restrict privileged RPC execution to the backend service role and validate actor status/role again in those operations.

Update frontend capabilities independently: USER gaining draft editing must not also gain approval. Continue showing signing records to all accounts, but expose the actual signing URL/action only to the Treasurer.

### 3 Bind signing requests to the Treasurer

Resolve the sole active Treasurer when creating a new signing request. Validate their email and explicit signing first/last names; do not guess a surname from display_name. Save the recipient profile and name/email snapshot on that request before making provider calls.

Use the saved snapshot for delivery retries, Firma recipient lookup and callback verification. Attribute completion to the request's saved profile instead of whichever account happens to be Treasurer when the callback arrives. Only the active Treasurer matching that request may obtain its signing URL or perform signing actions.

Keep PDF checksums, one-request-per-PDF idempotency and independently signed Firma callbacks. Retire runtime test-recipient fallbacks after the account-backed path passes. Test injection of recipient fixtures may remain.

### 4 Implement draft discard

Add `POST /api/meetings/{meetingId}/discard`, taking expectedVersion only and obtaining the actor from the session. Implement the operation through the existing service/repository/RPC boundaries.

In one database transaction, lock the meeting, check the active actor role and expected version, and verify that the record is an unapproved AI_FAILED or PENDING_APPROVAL draft. Deferred drafts are eligible. Processing, approved/locked, signing and completed records are protected. Verify there is no current approved snapshot or active PDF/signing workflow, including a concurrent approval or analysis claim.

Set discarded_at/discarded_by and append a DISCARDED history action. Preserve minutes, original transcript, normalization versions, attendees, motions, votes and all historical evidence. Increment the meeting version through the existing write mechanism exactly once. Repeated requests must not create repeated history entries.

Exclude discarded records at the database query boundary from normal list/search/detail/transcript/motions-summary reads. Update frontend counts and query invalidation for dashboard, queues and search. Direct bookmarked links should show the normal unavailable/not-found state.

Reject every mutation and analysis/recovery claim for a discarded record. Add a database guard against changing discarded meetings or their related draft content, so a late background result cannot revive them. Keep existing source ID uniqueness and duplicate-ingestion handling.

Add canDiscard and a confirmation in MeetingReviewActions. After success, return to the relevant queue and refresh affected queries. No bulk deletion or restoration UI is needed.

### 5 Remove obsolete account paths and verify

Show the signed-in display name and role in the existing shell. Add a small account query/provider separate from presentation preferences. Clear account-specific React Query data on sign-out/account change to prevent displaying the previous user's cached record.

Remove the Accounts navigation group, `/app/members` placeholder and corresponding tests/copy. Keep theme/avatar presentation preferences; do not turn them into an account-management feature. Remove runtime isAdmin/Superadmin branches, master-session handling, fixed actor fallbacks and outdated Microsoft setup text. Existing stored admin columns/enums may remain inert for compatibility.

Update `.env.example`, backend/root README and `docs/deployment/railway-staging.md`. Preserve the existing layout and unrelated features.

## Database migrations

Create four new timestamped migrations in the order below. Names are proposed suffixes; assign timestamps when implementing. Never rewrite a migration already shared with staging.

| Migration suffix | Required changes |
| --- | --- |
| `simplify_account_access.sql` | Add nullable signing_first_name/signing_last_name to profiles. Introduce distinct active-member edit and Officer/Treasurer approval/discard helpers. Update review and recovery actor gates; strengthen approve_meeting_for_pdf and retry_meeting_pdf_generation checks. Remove authenticated profile-update/admin-transfer access and broad direct draft/history writes so application mutations go through guarded service-role RPCs. Keep active self-profile reads, existing private storage, role enums, profile IDs and historical rows. |
| `add_draft_discard_history_action.sql` | Add DISCARDED to public.review_action. Commit this enum addition before the next migration uses the value. |
| `add_draft_discard.sql` | Add meetings.discarded_at and discarded_by, paired-field constraints, a profile FK and a useful partial index for non-discarded queue reads. Add the versioned discard RPC, immutable-discard guards, queue/detail filters and checks in review, approval, retry, normalization and analysis claim/persistence functions. Update read policies for discarded meeting evidence. Preserve normal lifecycle enums and immutable transcript/history protections. |
| `bind_signing_requests_to_treasurer.sql` | Add recipient_profile_id plus recipient_email/first_name/last_name snapshot columns to meeting_signing_requests. Update identity protection, delivery claim/retry/session/outcome RPCs and completion attribution. Require a complete snapshot for new account-backed requests. Preserve existing external request references and completed signed_by values. Backfill unfinished legacy envelopes only from verified recipient evidence; do not infer their signer from the newly active Treasurer. |

No custom password or session table is required. Supabase Auth stores credentials and sessions; manually provisioning auth users and profiles is operational data setup, not a schema migration.

Do not simply change the old authenticated meetings UPDATE policy from OFFICER to USER. It would allow direct row changes beyond the intended draft-edit API. Use the existing backend RPC model, narrow browser-token grants, and test direct REST/RPC denial. Keep old admin fields/helpers only where harmless or needed by historical migrations; they must confer no runtime privileges.

Run the complete migration chain on local Supabase and test existing fixtures. Review changed function grants and constraints, not just successful SQL execution. Historical migrations remain runnable from a fresh database.

## Staging configuration changes

### Supabase Auth and account data

Enable email/password sign-in and disable public signup and anonymous sign-in in the hosted staging Auth settings. Mirror that manual-account policy in local `supabase/config.toml`; changing the local file does not change hosted Auth configuration. Set the staging site URL to the actual Railway URL.

Manually create confirmed Auth users for Ernesto and Richard, then insert ACTIVE MEMBER profiles using the corresponding Auth UUIDs. Assign Ernesto OFFICER and Richard TREASURER with is_admin=false. Store normalized email and verified signing-name fields for Richard. Supabase's [admin createUser API](https://supabase.com/docs/reference/javascript/auth-admin-createuser) supports manual users and explicit email confirmation; the [Auth settings guide](https://supabase.com/docs/guides/auth/general-configuration) describes disabling signup. No SMTP or invitation flow is required for manually confirmed staging users.

Obtain real emails, Richard's signing name and initial passwords privately. Account UUIDs and credentials must not be hard-coded into authorization or committed. Document manual operator password resets without adding a user-facing reset flow.

The current seed/test Treasurer may already occupy the unique active-Treasurer slot. Inventory the hosted profiles and signing requests first. Retain historical identities; do not rename John Smith into Richard or rewrite approved_by/signed_by. Resolve any old in-flight test envelopes before switching, or explicitly snapshot their verified legacy recipient and retain callback compatibility. Atomically deactivate/demote the old test Treasurer and activate Richard so the final state has exactly one active Treasurer. Other fictional staging accounts should be inventoried and disabled for client access where appropriate, without deleting historical records. Do not apply the entire local seed to staging.

### Railway variables

| Variable or setting | Planned action |
| --- | --- |
| SUPABASE_URL | Keep the staging project URL. |
| SUPABASE_SECRET_KEY | Keep server-only for existing database/storage operations and manual provisioning. |
| SUPABASE_PUBLISHABLE_KEY | Add the staging publishable key for the server-side Auth client; support the local anon JWT key for local development. No NEXT_PUBLIC key is needed because the browser calls Next.js APIs. |
| APP_ORIGIN | Add the exact HTTPS Railway application origin for browser-mutation checks and safe hosted redirects. Local value is the chosen localhost origin. |
| MASTER_AUTH_USERNAME / MASTER_AUTH_PASSWORD | Retire after the individual-account release is verified. Clear legacy master cookies and do not keep a master-login bypass. |
| ANDA_STAGING_ACTOR_PROFILE_ID / ANDA_DEV_ACTOR_PROFILE_ID | Remove runtime dependence; retire deployed fixed-actor configuration after cutover. |
| SIGNING_TEST_SIGNER_FIRST_NAME / LAST_NAME / EMAIL | Retire application fallbacks after requests use Treasurer snapshots and legacy envelopes are reconciled. Local live-test fixtures can remain explicit test inputs. |
| ANDA_ENVIRONMENT | Keep the environment label; it no longer authorizes a fixed identity. |
| OpenAI, Firma, webhook and scheduler secrets | Keep current configuration and existing service authentication. |

No new hosting service, separate backend, storage bucket or Microsoft application is needed. Read AI/Telegram/scheduler activation remains outside this milestone. Verify actual secret names and values privately during release; this table is the proposed change list, not a live environment audit.

## Validation and release order

1. Implement and test locally on this feature branch. Use fresh local Auth users/profiles for USER/OFFICER/TREASURER coverage; do not rely on the fixed actor bypass.
2. Run `npm.cmd run check`, then the relevant local Supabase integration suites. Verify migrations with a clean local reset and an upgrade from the existing schema. Tests that use real OpenAI/Firma remain opt-in; a build alone does not prove authentication or role correctness.
3. Exercise email/password login, logout, refresh, unknown/missing profile, inactive account, invalid session, safe redirects and Railway-origin handling. Verify UI permissions and direct API/REST denial for each role. Test account switching without cached-data leakage.
4. Test discard of pending, failed and deferred drafts; denial for USER and all protected states; version conflict; two simultaneous requests; concurrent edit/approve/retry; delayed AI completion; and duplicate webhook delivery. Confirm evidence/history remains and every normal queue/count/read excludes the record.
5. Test signing delivery by the Officer, recipient snapshot/retries, Richard-only signing URL access, independently authenticated callback, completion attribution and searchable signed PDF. Test legacy-envelope handling separately; completed historical records must be unchanged.
6. Record a recoverable staging database backup, current deployed revision and private environment configuration. Inventory hosted migration status, accounts, old signing envelopes and the Railway-facing branch difference before applying anything.
7. Merge the feature through development and staging, reconcile GitLab/GitHub staging ancestry without force-overwriting either remote, and preserve the proxy-login fix behaviour. Mirror the reviewed staging release to the existing GitHub deployment repository.
8. Apply reviewed additive migrations to hosted staging in order using the established Supabase release process. Verify the remote migration ledger. The permission migration can change shared RPC behaviour, so use a short coordinated maintenance/cutover window rather than assume the old app remains fully compatible.
9. Provision the two accounts, perform the Treasurer cutover, configure Auth settings/new Railway values, deploy the reviewed application, and complete the staging browser/API checks. Then retire the old actor/master/test-signer values. Publish the two credentials privately.
10. Record migration versions, deployed revision, account UUIDs/roles, configuration changes and smoke results on #29. Mark it complete only after the agreed staging path works.

During a failed cutover, keep access paused and forward-fix or deploy a compatible revision. An old application does not understand discarded records or recipient snapshots: blindly rolling it back could reveal discarded drafts or use the wrong signer. Keep additive schema changes and retained evidence; database restoration is a separate operator decision. Record a rollback revision that understands the new guards before allowing discard on staging.

## Remaining inputs and completion boundary

Local implementation and verification are complete. Staging account creation and the real signing walkthrough require the two users' actual emails, Richard's verified signing name, private initial passwords and confirmation of any in-flight test envelopes. The client still owns the later account-onboarding decision.

This branch now contains the application changes, migrations, operator provisioning tool and regression coverage. No hosted users were provisioned, Railway settings changed, branches merged, commits pushed or staging deployment started during implementation. The uploaded GitLab plan attachment remains the original planning snapshot; repository documentation records the implementation results.
