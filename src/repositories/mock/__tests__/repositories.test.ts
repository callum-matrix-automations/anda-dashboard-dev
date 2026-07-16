import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../ports";
import { createMockRepositories } from "../repositories";

describe("mock repositories", () => {
  beforeEach(() => localStorage.clear());
  it("validates fixtures and returns defensive copies", async () => { const repo = createMockRepositories({ latencyMs: 0 }); const first = await repo.meetings.list(); first[0]!.title = "mutated"; expect((await repo.meetings.list())[0]!.title).not.toBe("mutated"); });
  it("increments versions and rejects stale writes", async () => { const repo = createMockRepositories({ latencyMs: 0 }); const meeting = await repo.meetings.get("mtg-2026-06-30"); const approved = await repo.meetings.applyAction(meeting.id, "APPROVE", { expectedVersion: meeting.version, actorName: "Daniel Okafor" }); expect(approved.status).toBe("PDF_PROCESSING"); expect(approved.version).toBe(meeting.version + 1); await expect(repo.meetings.applyAction(meeting.id, "PDF_COMPLETE", { expectedVersion: meeting.version })).rejects.toBeInstanceOf(ConflictError); });
  it("requires rejection comments and reopens editing", async () => { const repo = createMockRepositories({ latencyMs: 0 }); const meeting = await repo.meetings.get("mtg-2026-05-26"); await expect(repo.meetings.applyAction(meeting.id, "REJECT", { expectedVersion: meeting.version, comment: " " })).rejects.toThrow("comment"); const rejected = await repo.meetings.applyAction(meeting.id, "REJECT", { expectedVersion: meeting.version, comment: "Clarify the reserve transfer authorization.", actorName: "Priya Raman" }); expect(rejected.status).toBe("PENDING_APPROVAL"); expect(rejected.rejection?.comment).toContain("reserve transfer"); });
  it("rejects edits after approval and writes after completion", async () => { const repo = createMockRepositories({ latencyMs: 0 }); const locked = await repo.meetings.get("mtg-2026-06-16"); await expect(repo.meetings.updateContent(locked.id, { expectedVersion: locked.version, minutes: [] })).rejects.toThrow("locked"); const complete = await repo.meetings.get("mtg-2026-03-24"); await expect(repo.meetings.defer(complete.id, "Later", { expectedVersion: complete.version })).rejects.toThrow(); });
  it("supports search and contact handling", async () => { const repo = createMockRepositories({ latencyMs: 0 }); expect(await repo.archive.search("annual")).toHaveLength(2); expect((await repo.contacts.markHandled("wc-1")).handled).toBe(true); await expect(repo.contacts.markHandled("missing")).rejects.toThrow("not found"); });
  it("lists every repository and updates valid members", async () => {
    const repo = createMockRepositories({ latencyMs: 0 });
    expect(await repo.archive.list()).not.toHaveLength(0);
    expect(await repo.financials.list()).not.toHaveLength(0);
    expect(await repo.properties.list()).not.toHaveLength(0);
    expect(await repo.vendors.list()).not.toHaveLength(0);
    expect(await repo.contacts.list()).not.toHaveLength(0);
    const member = (await repo.members.list())[0]!;
    expect((await repo.members.update({ ...member, position: "Finance Chair" })).position).toBe("Finance Chair");
    await expect(repo.members.update({ ...member, id: "missing" })).rejects.toThrow("not found");
  });
  it("transfers the sole Treasurer atomically and assigns the outgoing Treasurer a role", async () => {
    const repo = createMockRepositories({ latencyMs: 0 });
    const transferred = await repo.members.transferTreasurer("mem-02");
    expect(transferred.filter((member) => member.role === "treasurer")).toHaveLength(1);
    expect(transferred.find((member) => member.id === "mem-02")?.role).toBe("treasurer");
    expect(transferred.find((member) => member.id === "mem-01")?.role).toBe("officer");
  });

  it("preserves exactly one active Treasurer across exhaustive role/status updates", async () => {
    const roles = ["user", "officer", "treasurer"] as const;
    for (const targetId of ["mem-01", "mem-02"]) {
      for (const role of roles) {
        for (const active of [false, true]) {
          const repo = createMockRepositories({ latencyMs: 0 });
          const member = (await repo.members.list()).find((item) => item.id === targetId)!;
          const changesTreasurerIdentity = (member.role === "treasurer") !== (role === "treasurer");
          const invalidTreasurerStatus = member.role === "treasurer" && !active;
          if (changesTreasurerIdentity || invalidTreasurerStatus) {
            await expect(repo.members.update({ ...member, role, active })).rejects.toThrow("transferTreasurer");
          } else {
            await repo.members.update({ ...member, role, active });
          }
          const members = await repo.members.list();
          expect(members.filter((item) => item.active && item.role === "treasurer"), `${targetId}/${role}/${active}`).toHaveLength(1);
        }
      }
    }
  });

  it.each(["", "   ", "missing-at.example", `${"a".repeat(245)}@example.com`])("rejects invalid invitation email %j", async (email) => {
    const repo = createMockRepositories({ latencyMs: 0 });
    await expect(repo.members.invite(email)).rejects.toThrow();
  });

  it("normalizes a valid invitation email", async () => {
    const repo = createMockRepositories({ latencyMs: 0 });
    await expect(repo.members.invite("  member@example.com  ")).resolves.toBe("member@example.com");
  });

  it("defers, resumes, and validates invalid operations", async () => {
    const repo = createMockRepositories({ latencyMs: 0 });
    const meeting = await repo.meetings.get("mtg-2026-06-30");
    const deferred = await repo.meetings.defer(meeting.id, undefined, { expectedVersion: meeting.version });
    expect(deferred.deferredNote).toBeNull();
    await expect(repo.meetings.applyAction(meeting.id, "APPROVE", { expectedVersion: deferred.version })).rejects.toThrow("Resume");
    await expect(repo.meetings.defer(meeting.id, "Again", { expectedVersion: deferred.version })).rejects.toThrow("cannot");
    const resumed = await repo.meetings.resume(meeting.id, { expectedVersion: deferred.version });
    expect(resumed.deferredAt).toBeNull();
    await expect(repo.meetings.resume(meeting.id, { expectedVersion: resumed.version })).rejects.toThrow("not deferred");
    await expect(repo.meetings.get("missing")).rejects.toThrow("not found");
    await expect(repo.meetings.applyAction(meeting.id, "SIGN", { expectedVersion: resumed.version })).rejects.toThrow("not allowed");
  });
  it("persists human-owned structured edits without approving", async () => {
    const repo=createMockRepositories({latencyMs:0});const meeting=await repo.meetings.get("mtg-2026-06-30");
    const edited=await repo.meetings.updateContent(meeting.id,{expectedVersion:meeting.version,humanOwned:true,minutes:[{...meeting.minutes[0]!,body:"Human-authored minutes."}],attendees:meeting.attendees,motions:meeting.motions});
    expect(edited.status).toBe("PENDING_APPROVAL");expect(edited.humanOwned).toBe(true);expect(edited.version).toBe(meeting.version+1);expect(edited.transcript).toBe(meeting.transcript);
  });
  it("allows approval with unresolved votes and locks subsequent edits",async()=>{const repo=createMockRepositories({latencyMs:0});const meeting=await repo.meetings.get("mtg-2026-06-30");expect(meeting.motions.some(m=>m.votes.some(v=>v.result==="unresolved"))).toBe(true);const approved=await repo.meetings.applyAction(meeting.id,"APPROVE",{expectedVersion:meeting.version});expect(approved.status).toBe("PDF_PROCESSING");await expect(repo.meetings.updateContent(meeting.id,{expectedVersion:approved.version,minutes:[]})).rejects.toThrow("locked");});
});
