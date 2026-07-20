import { describe, expect, it, vi } from "vitest";
import {
  createArchiveDetailHandler,
  createArchiveDocumentHandler,
  createArchiveListHandler,
  createArchiveRecoveryHandler,
} from "../../src/backend/integrations/archive/meetingArchiveHandlers";

const secret = "test-archive-secret";
const meetingId = "11111111-1111-4111-8111-111111111111";
const pdfId = "22222222-2222-4222-8222-222222222222";
const actorResolver = vi.fn().mockResolvedValue({
  profileId: "33333333-3333-4333-8333-333333333333",
  displayName: "Active Member",
  role: "USER" as const,
  isAdmin: false,
});

describe("completed meeting archive APIs", () => {
  it("authenticates and forwards year, category, topic, and pagination filters", async () => {
    const service = serviceMock();
    const handler = createArchiveListHandler({ service, actorResolver });
    const response = await handler(request(
      `/api/archive?q=budget&year=2026&category=Board%20Meeting&limit=10&offset=20`,
    ));

    expect(response.status).toBe(200);
    expect(service.search).toHaveBeenCalledWith({
      query: "budget",
      year: 2026,
      category: "Board Meeting",
      limit: 10,
      offset: 20,
    });
  });

  it("rejects missing authentication and invalid filters", async () => {
    const service = serviceMock();
    const unauthenticated = createArchiveListHandler({
      service,
      actorResolver: vi.fn().mockResolvedValue(null),
    });
    const handler = createArchiveListHandler({ service, actorResolver });

    expect((await unauthenticated(new Request("https://anda.test/api/archive"))).status).toBe(401);
    expect((await handler(request("/api/archive?year=not-a-year"))).status).toBe(400);
    expect((await handler(request("/api/archive?category=Private"))).status).toBe(400);
    expect(service.search).not.toHaveBeenCalled();
  });

  it("fails closed when actor authentication is unavailable", async () => {
    const service = serviceMock();
    const handler = createArchiveListHandler({
      service,
      actorResolver: vi.fn().mockRejectedValue(new Error("unavailable")),
    });

    expect((await handler(request("/api/archive"))).status).toBe(503);
    expect(service.search).not.toHaveBeenCalled();
  });

  it("returns completed details without exposing a storage path", async () => {
    const service = serviceMock();
    const handler = createArchiveDetailHandler({ service, actorResolver });
    const response = await handler(request(`/api/archive/${meetingId}`), context(meetingId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ meetingId, signedPdfId: pdfId });
    expect(JSON.stringify(body)).not.toContain("storagePath");
  });

  it("issues no-store temporary document access and maps missing archives", async () => {
    const service = serviceMock();
    const handler = createArchiveDocumentHandler({ service, actorResolver });
    const response = await handler(request(`/api/archive/${meetingId}/document`), context(meetingId));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      meetingId,
      pdfId,
      url: expect.stringContaining("/object/sign/"),
    });

    service.createDocumentAccess = vi.fn().mockResolvedValue({ status: "not_found", meetingId });
    expect((await handler(request(`/api/archive/${meetingId}/document`), context(meetingId))).status)
      .toBe(404);
  });

  it("runs protected durable archive recovery with a bounded batch size", async () => {
    const recover = vi.fn().mockResolvedValue({ processed: 1, results: [] });
    const handler = createArchiveRecoveryHandler({ recover, secret });
    const response = await handler(new Request("https://anda.test/api/internal/archive/recover", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 15 }),
    }));

    expect(response.status).toBe(200);
    expect(recover).toHaveBeenCalledWith(15);
    expect((await handler(new Request("https://anda.test/api/internal/archive/recover", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify({ limit: 101 }),
    }))).status).toBe(400);
  });
});

function request(path: string, token: string | undefined = secret) {
  return new Request(`https://anda.test${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function context(id: string) {
  return { params: Promise.resolve({ meetingId: id }) };
}

function serviceMock() {
  return {
    search: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 }),
    get: vi.fn().mockResolvedValue({ status: "available", archive: archiveDetail() }),
    createDocumentAccess: vi.fn().mockResolvedValue({
      status: "available",
      access: {
        meetingId,
        pdfId,
        url: "https://supabase.example.test/storage/v1/object/sign/file?token=test",
        expiresAt: "2026-07-20T14:05:00.000Z",
      },
    }),
  };
}

function archiveDetail() {
  return {
    meetingId,
    title: "ANDA Board Meeting",
    meetingDate: "2026-07-20",
    category: "Board Meeting" as const,
    tags: ["budget"],
    signedBy: "33333333-3333-4333-8333-333333333333",
    signedAt: "2026-07-20T13:00:00.000Z",
    signedPdfId: pdfId,
    completedAt: "2026-07-20T14:00:00.000Z",
    version: 8,
    minutes: { summary: "Approved." },
    motions: [],
    document: {
      pdfId,
      sha256: "a".repeat(64),
      sizeBytes: 12_000,
      pageCount: 3,
      documentVersion: 7,
    },
  };
}
