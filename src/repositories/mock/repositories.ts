import { isApprovalTransitionAllowed, transition, transitionRejection, type MeetingAction } from "@/domain/stateMachine";
import { appendHistoryEntry } from "@/domain/history";
import { draftIssues } from "@/domain/manualDraft";
import { z } from "zod";
import { ArchiveEntrySchema, FinancialLineSchema, MeetingSchema, MeetingTagSchema, MemberSchema, PropertySchema, VendorSchema, WebContactSchema, type HistoryAction, type Meeting } from "@/domain/types";
import type { Repositories } from "../ports";
import { ConflictError } from "../ports";
import { archiveEntries, financials, meetings, members, properties, vendors, webContacts } from "./fixtures";

export interface MockOptions { latencyMs?: number; conflictOnNextWrite?: boolean }
const clone = <T>(value: T): T => structuredClone(value);

// AIDEV-NOTE: Every lifecycle action maps 1:1 onto a history entry; SIGN additionally
// records the simulated archive step so timelines show sign + archive as separate facts.
const HISTORY_FOR_ACTION: Record<MeetingAction, HistoryAction> = {
  AI_RETRY: "analysis_retried",
  AI_MARK_MANUAL_READY: "marked_ready",
  AI_COMPLETE: "analysis_completed",
  AI_FAIL: "analysis_failed",
  APPROVE: "approved",
  PDF_COMPLETE: "pdf_generated",
  PDF_FAIL: "pdf_failed",
  PDF_RETRY: "pdf_retried",
  SIGN: "signed",
  SIGN_FAIL: "signature_failed",
  SIGN_RETRY: "signature_retried",
  REJECT: "rejected",
  ARCHIVE_FAIL: "archive_failed",
  ARCHIVE_RETRY: "archived",
};

// History is append-only and never shrinks, so `length + 1` yields stable unique ids.
function appendEntries(
  current: Meeting,
  entries: Array<{ action: HistoryAction; actor: string; note?: string | null }>,
  at: string,
) {
  return entries.reduce(
    (history, entry) =>
      appendHistoryEntry(history, {
        id: `${current.id}-h${history.length + 1}`,
        actor: entry.actor,
        action: entry.action,
        at,
        note: entry.note ?? null,
      }),
    current.history,
  );
}

const CONTENT_EDITABLE_STATUSES = ["PENDING_APPROVAL", "AI_FAILED"];

// AIDEV-NOTE: Instance-scoped state keeps tests and demo sessions deterministic and isolated.
export function createMockRepositories(options: MockOptions = {}): Repositories {
  const latency = options.latencyMs ?? 300;
  let forceConflict = options.conflictOnNextWrite ?? false;
  let meetingState = MeetingSchema.array().parse(clone(meetings));
  let memberState = MemberSchema.array().parse(clone(members));
  let contactState = WebContactSchema.array().parse(clone(webContacts));
  const wait = async () => { if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency)); };
  const findMeeting = (id: string) => { const item = meetingState.find((meeting) => meeting.id === id); if (!item) throw new Error("Meeting not found."); return item; };
  const write = (id: string, expectedVersion: number, mutate: (current: Meeting) => Meeting) => {
    const current = findMeeting(id);
    if (forceConflict) {
      // Simulate a concurrent local-demo write so recovery must refetch a genuinely newer version.
      forceConflict = false;
      const advanced = MeetingSchema.parse({ ...clone(current), version: current.version + 1 });
      meetingState = meetingState.map((item) => item.id === id ? advanced : item);
      throw new ConflictError();
    }
    if (current.version !== expectedVersion) throw new ConflictError();
    const next = MeetingSchema.parse({ ...mutate(clone(current)), version: current.version + 1 });
    meetingState = meetingState.map((item) => item.id === id ? next : item);
    return clone(next);
  };
  return {
    meetings: {
      async list() { await wait(); return clone(meetingState); },
      async get(id) { await wait(); return clone(findMeeting(id)); },
      async completeManualDraft(id, content, input) {
        await wait();
        return write(id, input.expectedVersion, (current) => {
          const result = transition(current.status, "AI_MARK_MANUAL_READY");
          if (!result.ok) throw new Error(result.error);
          const candidate = { ...current, ...content, humanOwned: true };
          const issues = draftIssues(candidate);
          if (issues.length > 0) throw new Error(issues[0]!);
          const now = new Date().toISOString();
          const actor = input.actorName ?? "Officer";
          return {
            ...candidate,
            status: result.status,
            failureReason: null,
            history: appendEntries(
              current,
              [
                { action: "edit_saved", actor, note: "Manual recovery draft completed." },
                { action: "marked_ready", actor, note: "Human-owned draft marked ready for approval." },
              ],
              now,
            ),
          };
        });
      },
      async applyAction(id, action, input) {
        await wait();
        return write(id, input.expectedVersion, (current) => {
          if (action === "APPROVE" && current.status === "PENDING_APPROVAL" && !isApprovalTransitionAllowed(current)) {
            throw new Error("Resume the deferred meeting before approval.");
          }
          const result = (() => {
            if (action === "REJECT") {
              const rejection = transitionRejection(current.status, input.comment);
              if (!rejection.ok) throw new Error(rejection.error);
              return { status: rejection.status, rejectionComment: rejection.comment };
            }
            const standard = transition(current.status, action);
            if (!standard.ok) throw new Error(standard.error);
            return { status: standard.status, rejectionComment: null };
          })();
          // AIDEV-NOTE: An empty manual draft can never be marked ready — same rule the
          // complete-manually wizard enforces; the first issue is the actionable error.
          if (action === "AI_MARK_MANUAL_READY") {
            const issues = draftIssues(current);
            if (issues.length > 0) throw new Error(issues[0]!);
          }
          const now = new Date().toISOString();
          const actor = input.actorName ?? (action === "REJECT" || action === "SIGN" ? "Treasurer" : "System");
          const next: Meeting = { ...current, status: result.status };
          if (action === "APPROVE") {
            next.deferredAt = null;
            next.deferredNote = null;
            next.rejection = null;
            // AIDEV-NOTE: Artifact version increments on every approval, so a
            // reject -> re-approve cycle visibly produces a NEW document version.
            next.pdfArtifact = { name: `${current.title} — Minutes.pdf`, version: (current.pdfArtifact?.version ?? 0) + 1, generatedAt: null, pageCount: null, sizeLabel: null };
          }
          if (action === "PDF_COMPLETE") {
            next.pdfArtifact = { name: current.pdfArtifact?.name ?? `${current.title} — Minutes.pdf`, version: current.pdfArtifact?.version ?? 1, generatedAt: now, pageCount: 6, sizeLabel: "410 KB" };
          }
          if (action === "REJECT") {
            if (result.rejectionComment === null) throw new Error("Rejection transition did not return a validated comment.");
            next.rejection = { by: actor, comment: result.rejectionComment, at: now };
            next.signedBy = null;
            next.signedAt = null;
          }
          if (action === "SIGN" || action === "ARCHIVE_FAIL") {
            next.signedBy = actor;
            next.signedAt = now;
            // AIDEV-NOTE: ARCHIVE_FAIL occurs after signing succeeds. Preserve the
            // signature while leaving archivedAt empty for automatic recovery.
            next.archivedAt = action === "SIGN" ? now : null;
          }
          if (action === "ARCHIVE_RETRY") next.archivedAt = now;
          // A manual retry starts a fresh automatic-attempt cycle (1 of 3).
          if (action === "AI_RETRY") next.analysisAttempt = 1;
          next.failureReason = result.status.endsWith("FAILED") ? current.failureReason : null;
          const entries: Array<{ action: HistoryAction; actor: string; note?: string | null }> = [
            { action: HISTORY_FOR_ACTION[action], actor, note: result.rejectionComment },
          ];
          if (action === "SIGN") entries.push({ action: "archived", actor: "System", note: "Demo archive state recorded locally; no PDF file was stored." });
          if (action === "ARCHIVE_FAIL") {
            entries.unshift({ action: "signed", actor, note: "Demo signature state completed before the fixture archive failure." });
          }
          next.history = appendEntries(current, entries, now);
          return next;
        });
      },
      async updateContent(id, patch) {
        await wait();
        return write(id, patch.expectedVersion, (current) => {
          if (!CONTENT_EDITABLE_STATUSES.includes(current.status)) throw new Error("Meeting content is locked after approval.");
          return {
            ...current,
            minutes: patch.minutes ?? current.minutes,
            attendees: patch.attendees ?? current.attendees,
            motions: patch.motions ?? current.motions,
            // Any write through this human-editing boundary makes ownership
            // monotonic; callers cannot hand completed work back to automation.
            humanOwned: true,
            history: appendEntries(current, [{ action: "edit_saved", actor: patch.actorName ?? "Officer" }], new Date().toISOString()),
          };
        });
      },
      async updateTags(id, tags, input) {
        await wait();
        const parsed = MeetingTagSchema.array().max(20).parse(tags);
        const normalized = parsed.map((tag) => tag.toLocaleLowerCase());
        if (new Set(normalized).size !== normalized.length) {
          throw new Error("Duplicate tags are not allowed.");
        }
        return write(id, input.expectedVersion, (current) => {
          if (!CONTENT_EDITABLE_STATUSES.includes(current.status)) throw new Error("Tags are read-only after approval.");
          return {
            ...current,
            tags: parsed,
            history: appendEntries(current, [{ action: "tags_updated", actor: input.actorName ?? "Officer" }], new Date().toISOString()),
          };
        });
      },
      async defer(id, note, input) {
        await wait();
        return write(id, input.expectedVersion, (current) => {
          if (!CONTENT_EDITABLE_STATUSES.includes(current.status) || current.deferredAt) throw new Error("This meeting cannot be deferred.");
          const now = new Date().toISOString();
          return {
            ...current,
            deferredAt: now,
            deferredNote: note?.trim() || null,
            history: appendEntries(current, [{ action: "deferred", actor: input.actorName ?? "Officer", note: note?.trim() || null }], now),
          };
        });
      },
      async resume(id, input) {
        await wait();
        return write(id, input.expectedVersion, (current) => {
          if (!current.deferredAt) throw new Error("Meeting is not deferred.");
          return {
            ...current,
            deferredAt: null,
            deferredNote: null,
            history: appendEntries(current, [{ action: "resumed", actor: input.actorName ?? "Officer" }], new Date().toISOString()),
          };
        });
      },
    },
    archive: { async list() { await wait(); return ArchiveEntrySchema.array().parse(clone(archiveEntries)); }, async search(query) { await wait(); const q = query.trim().toLowerCase(); return clone(archiveEntries.filter((entry) => entry.title.toLowerCase().includes(q) || entry.category.toLowerCase().includes(q))); } },
    members: {
      async list() { await wait(); return clone(memberState); },
      async update(member) {
        await wait();
        const parsed = MemberSchema.parse(member);
        const current = memberState.find((item) => item.id === parsed.id);
        if (!current) throw new Error("Member not found.");
        // AIDEV-NOTE: Treasurer replacement is atomic-only; ordinary updates may never create zero or multiple active Treasurers.
        if (current.role === "treasurer" && (!parsed.active || parsed.role !== "treasurer")) {
          throw new Error("Use transferTreasurer before demoting or deactivating the Treasurer.");
        }
        if (current.role !== "treasurer" && parsed.role === "treasurer") {
          throw new Error("Use transferTreasurer to assign the Treasurer role.");
        }
        const candidate = memberState.map((item) => item.id === parsed.id ? parsed : item);
        if (candidate.filter((item) => item.active && item.role === "treasurer").length !== 1) {
          throw new Error("Exactly one active Treasurer must exist.");
        }
        memberState = candidate;
        return clone(parsed);
      },
      async transferTreasurer(nextTreasurerId) {
        await wait();
        const nextTreasurer = memberState.find((item) => item.id === nextTreasurerId && item.active);
        const currentTreasurer = memberState.find((item) => item.role === "treasurer");
        if (!nextTreasurer) throw new Error("The replacement Treasurer must be an active account.");
        if (!currentTreasurer) throw new Error("A Treasurer must always exist.");
        if (nextTreasurer.id === currentTreasurer.id) return clone(memberState);
        // AIDEV-NOTE: Both roles change in one state replacement; observers can never see zero Treasurers.
        memberState = memberState.map((item) => item.id === nextTreasurer.id
          ? { ...item, role: "treasurer", position: "Treasurer" }
          : item.id === currentTreasurer.id
            ? { ...item, role: "officer", position: "Former Treasurer" }
            : item);
        return clone(MemberSchema.array().parse(memberState));
      },
      async invite(email) {
        await wait();
        const result = z.string().trim().min(1, "Email is required.").max(254, "Email must be 254 characters or fewer.").email("Enter a valid email address.").safeParse(email);
        if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Enter a valid email address.");
        return result.data;
      },
    },
    financials: { async list() { await wait(); return FinancialLineSchema.array().parse(clone(financials)); } },
    properties: { async list() { await wait(); return PropertySchema.array().parse(clone(properties)); } },
    vendors: { async list() { await wait(); return VendorSchema.array().parse(clone(vendors)); } },
    contacts: { async list() { await wait(); return clone(contactState); }, async markHandled(id) { await wait(); const found = contactState.find((item) => item.id === id); if (!found) throw new Error("Contact not found."); const next = { ...found, handled: true }; contactState = contactState.map((item) => item.id === id ? next : item); return clone(next); } },
  };
}
