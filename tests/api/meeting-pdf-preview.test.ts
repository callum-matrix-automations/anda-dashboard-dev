import { describe, expect, it, vi } from "vitest";
import { createMeetingPdfPreviewHandler } from "../../src/backend/integrations/meetings/meetingPdfPreviewHandler";

const meetingId = "11111111-1111-4111-8111-111111111111";
const officerResolver = vi.fn().mockResolvedValue({
  profileId: "22222222-2222-4222-8222-222222222222",
  displayName: "Board Officer",
  role: "OFFICER" as const,
  isAdmin: false,
});

describe("meeting PDF preview API", () => {
  it("requires authentication and reviewer permission", async () => {
    const previewService = vi.fn();
    const unauthenticated = createMeetingPdfPreviewHandler({
      previewService,
      actorResolver: vi.fn().mockResolvedValue(null),
    });
    const member = createMeetingPdfPreviewHandler({
      previewService,
      actorResolver: vi.fn().mockResolvedValue({
        profileId: "33333333-3333-4333-8333-333333333333",
        displayName: "Member",
        role: "USER",
        isAdmin: false,
      }),
    });

    expect((await unauthenticated(request(), context())).status).toBe(401);
    expect((await member(request(), context())).status).toBe(403);
    expect(previewService).not.toHaveBeenCalled();
  });

  it("streams the private PDF inline without exposing its storage path", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 private bytes");
    const handler = createMeetingPdfPreviewHandler({
      actorResolver: officerResolver,
      previewService: vi.fn().mockResolvedValue({ status: "available", meetingId, documentVersion: 4, bytes }),
    });

    const response = await handler(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="anda-meeting-minutes-v4.pdf"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect([...response.headers.values()].join(" ")).not.toContain("unsigned/");
  });

  it.each([
    ["not_found", 404, "meeting_not_found"],
    ["not_ready", 409, "pdf_preview_not_ready"],
  ] as const)("maps %s results to a safe API error", async (status, expectedStatus, code) => {
    const handler = createMeetingPdfPreviewHandler({
      actorResolver: officerResolver,
      previewService: vi.fn().mockResolvedValue({ status, meetingId }),
    });
    const response = await handler(request(), context());
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("returns a sanitised service error when private storage is unavailable", async () => {
    const handler = createMeetingPdfPreviewHandler({
      actorResolver: officerResolver,
      previewService: vi.fn().mockRejectedValue(new Error("secret storage details")),
    });
    const response = await handler(request(), context());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "pdf_preview_unavailable",
        message: "The approved PDF preview is temporarily unavailable.",
      },
    });
  });
});

function request() {
  return new Request(`http://localhost/api/meetings/${meetingId}/pdf/preview`);
}

function context(id = meetingId) {
  return { params: Promise.resolve({ meetingId: id }) };
}
