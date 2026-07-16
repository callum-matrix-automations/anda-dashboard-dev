import { describe, expect, it } from "vitest";
import { MeetingSourceSchema } from "@/domain/types";
import { createMockRepositories } from "../repositories";

// AIDEV-NOTE: Covers the diagram-completion additions — provenance fixtures,
// append-only history writes, tag lifecycle, and archive timestamps.
const repo = () => createMockRepositories({ latencyMs: 0 });

describe("provenance and source fixtures", () => {
  it("gives every meeting a valid Teams source with participants", async () => {
    const meetings = await repo().meetings.list();
    expect(meetings.length).toBeGreaterThan(0);
    for (const meeting of meetings) {
      expect(MeetingSourceSchema.safeParse(meeting.source).success).toBe(true);
      expect(meeting.source.participants.length).toBeGreaterThan(0);
    }
  });

  it("covers all three transcript import statuses across fixtures", async () => {
    const meetings = await repo().meetings.list();
    const statuses = new Set(meetings.map((m) => m.source.importStatus));
    expect(statuses).toEqual(new Set(["imported", "imported_with_gaps", "import_failed"]));
  });

  it("includes at least one unmatched participant in the corpus", async () => {
    const meetings = await repo().meetings.list();
    expect(meetings.some((m) => m.source.participants.some((p) => !p.matched))).toBe(true);
  });
});

describe("analysis attempt fixtures", () => {
  it("marks the AI_FAILED fixture as exhausted at attempt 3", async () => {
    const meetings = await repo().meetings.list();
    const failed = meetings.find((m) => m.status === "AI_FAILED");
    expect(failed?.analysisAttempt).toBe(3);
  });

  it("resets the attempt counter when analysis is retried", async () => {
    const store = repo();
    const failed = (await store.meetings.list()).find((m) => m.status === "AI_FAILED")!;
    const retried = await store.meetings.applyAction(failed.id, "AI_RETRY", {
      expectedVersion: failed.version,
      actorName: "Daniel Okafor",
    });
    expect(retried.status).toBe("AI_PROCESSING");
    expect(retried.analysisAttempt).toBe(1);
  });
});

describe("mark ready requires a complete manual draft", () => {
  it("rejects AI_MARK_MANUAL_READY while the structured draft is empty", async () => {
    const store = repo();
    const failed = (await store.meetings.list()).find((m) => m.status === "AI_FAILED")!;
    expect(failed.minutes).toHaveLength(0);
    await expect(
      store.meetings.applyAction(failed.id, "AI_MARK_MANUAL_READY", {
        expectedVersion: failed.version,
        actorName: "Daniel Okafor",
      }),
    ).rejects.toThrow(/minutes section/i);
  });

  it("allows AI_MARK_MANUAL_READY once a complete draft exists", async () => {
    const store = repo();
    const failed = (await store.meetings.list()).find((m) => m.status === "AI_FAILED")!;
    const drafted = await store.meetings.updateContent(failed.id, {
      expectedVersion: failed.version,
      humanOwned: true,
      minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }],
      actorName: "Daniel Okafor",
    });
    const ready = await store.meetings.applyAction(drafted.id, "AI_MARK_MANUAL_READY", {
      expectedVersion: drafted.version,
      actorName: "Daniel Okafor",
    });
    expect(ready.status).toBe("PENDING_APPROVAL");
    expect(ready.history.at(-1)?.action).toBe("marked_ready");
  });

  it("atomically saves and marks a complete manual draft ready in one versioned write", async () => {
    const store = repo();
    const failed = (await store.meetings.list()).find((m) => m.status === "AI_FAILED")!;
    const ready = await store.meetings.completeManualDraft(
      failed.id,
      {
        minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }],
        attendees: failed.attendees,
        motions: [],
      },
      { expectedVersion: failed.version, actorName: "Daniel Okafor" },
    );
    expect(ready.version).toBe(failed.version + 1);
    expect(ready.status).toBe("PENDING_APPROVAL");
    expect(ready.humanOwned).toBe(true);
    expect(ready.history.slice(-2).map((entry) => entry.action)).toEqual(["edit_saved", "marked_ready"]);
  });
});

describe("manual tags", () => {
  it("updates tags before approval and records a history entry", async () => {
    const store = repo();
    const meeting = await store.meetings.get("mtg-2026-06-30");
    const updated = await store.meetings.updateTags(meeting.id, ["Pool", "Contracts", "Budget"], {
      expectedVersion: meeting.version,
      actorName: "Daniel Okafor",
    });
    expect(updated.tags).toEqual(["Pool", "Contracts", "Budget"]);
    expect(updated.version).toBe(meeting.version + 1);
    const last = updated.history.at(-1);
    expect(last?.action).toBe("tags_updated");
    expect(last?.actor).toBe("Daniel Okafor");
  });

  it("rejects tag edits after approval and on completed records", async () => {
    const store = repo();
    const locked = await store.meetings.get("mtg-2026-06-16");
    await expect(
      store.meetings.updateTags(locked.id, ["Late"], { expectedVersion: locked.version }),
    ).rejects.toThrow(/read-only|locked/i);
    const completed = await store.meetings.get("mtg-2026-03-24");
    await expect(
      store.meetings.updateTags(completed.id, ["Late"], { expectedVersion: completed.version }),
    ).rejects.toThrow(/read-only|locked|immutable/i);
  });

  it("rejects blank tags at the boundary", async () => {
    const store = repo();
    const meeting = await store.meetings.get("mtg-2026-06-30");
    await expect(
      store.meetings.updateTags(meeting.id, ["  "], { expectedVersion: meeting.version }),
    ).rejects.toThrow();
  });

  it("rejects case-insensitive duplicate tags at the repository boundary", async () => {
    const store = repo();
    const meeting = await store.meetings.get("mtg-2026-06-30");
    await expect(
      store.meetings.updateTags(meeting.id, ["Budget", "budget"], { expectedVersion: meeting.version }),
    ).rejects.toThrow(/duplicate/i);
  });
});

describe("review history appends", () => {
  it("appends approved/rejected/signed entries without dropping earlier ones", async () => {
    const store = repo();
    const pending = await store.meetings.get("mtg-2026-06-30");
    const before = pending.history.length;
    const approved = await store.meetings.applyAction(pending.id, "APPROVE", {
      expectedVersion: pending.version,
      actorName: "Daniel Okafor",
    });
    expect(approved.history).toHaveLength(before + 1);
    expect(approved.history.at(-1)).toMatchObject({ action: "approved", actor: "Daniel Okafor" });

    const signing = await store.meetings.get("mtg-2026-05-26");
    const rejected = await store.meetings.applyAction(signing.id, "REJECT", {
      expectedVersion: signing.version,
      comment: "Vote tally for motion 5 is wrong.",
      actorName: "Priya Raman",
    });
    expect(rejected.history.at(-1)).toMatchObject({
      action: "rejected",
      actor: "Priya Raman",
      note: "Vote tally for motion 5 is wrong.",
    });
  });

  it("records signing and archiving and stamps archivedAt on SIGN", async () => {
    const store = repo();
    const signing = await store.meetings.get("mtg-2026-05-26");
    const signed = await store.meetings.applyAction(signing.id, "SIGN", {
      expectedVersion: signing.version,
      actorName: "Priya Raman",
    });
    expect(signed.status).toBe("COMPLETED");
    expect(signed.archivedAt).not.toBeNull();
    const actions = signed.history.map((entry) => entry.action);
    expect(actions).toContain("signed");
    expect(actions).toContain("archived");
  });

  it("records the successful signature before an archive failure", async () => {
    const store = repo();
    const signing = await store.meetings.get("mtg-2026-05-26");
    const failed = await store.meetings.applyAction(signing.id, "ARCHIVE_FAIL", {
      expectedVersion: signing.version,
      actorName: "Priya Raman",
    });
    expect(failed.status).toBe("ARCHIVE_FAILED");
    expect(failed.signedBy).toBe("Priya Raman");
    expect(failed.signedAt).not.toBeNull();
    expect(failed.archivedAt).toBeNull();
    expect(failed.history.slice(-2).map((entry) => entry.action)).toEqual(["signed", "archive_failed"]);
  });

  it("appends entries for edits, deferrals, and resumes", async () => {
    const store = repo();
    const meeting = await store.meetings.get("mtg-2026-06-30");
    const edited = await store.meetings.updateContent(meeting.id, {
      expectedVersion: meeting.version,
      humanOwned: true,
      minutes: meeting.minutes,
      actorName: "Daniel Okafor",
    });
    expect(edited.history.at(-1)?.action).toBe("edit_saved");
    const deferred = await store.meetings.defer(meeting.id, "Waiting on vendor quote", {
      expectedVersion: edited.version,
      actorName: "Daniel Okafor",
    });
    expect(deferred.history.at(-1)).toMatchObject({ action: "deferred", note: "Waiting on vendor quote" });
    const resumed = await store.meetings.resume(meeting.id, {
      expectedVersion: deferred.version,
      actorName: "Daniel Okafor",
    });
    expect(resumed.history.at(-1)?.action).toBe("resumed");
  });

  it("makes human ownership monotonic for every content edit", async () => {
    const store = repo();
    const meeting = await store.meetings.get("mtg-2026-06-30");
    const edited = await store.meetings.updateContent(meeting.id, {
      expectedVersion: meeting.version,
      minutes: meeting.minutes,
      actorName: "Daniel Okafor",
    });
    expect(edited.humanOwned).toBe(true);
    const attemptedReset = await store.meetings.updateContent(edited.id, {
      expectedVersion: edited.version,
      humanOwned: false,
      minutes: edited.minutes,
      actorName: "Daniel Okafor",
    });
    expect(attemptedReset.humanOwned).toBe(true);
  });

  it("keeps history free of field-level snapshots", async () => {
    const meetings = await repo().meetings.list();
    for (const meeting of meetings) {
      for (const entry of meeting.history) {
        expect(Object.keys(entry).sort()).toEqual(["action", "actor", "at", "id", "note"]);
      }
    }
  });
});

describe("signed artifact fixtures", () => {
  it("gives post-approval fixtures a PDF artifact and completed records an archive timestamp", async () => {
    const meetings = await repo().meetings.list();
    for (const meeting of meetings) {
      if (["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED", "COMPLETED"].includes(meeting.status)) {
        expect(meeting.pdfArtifact).not.toBeNull();
        expect(meeting.pdfArtifact?.generatedAt).not.toBeNull();
      }
    }
    const completed = meetings.find((m) => m.status === "COMPLETED");
    expect(completed?.archivedAt).not.toBeNull();
  });
});
