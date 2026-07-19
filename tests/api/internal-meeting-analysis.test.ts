import { describe, expect, it, vi } from "vitest";
import { createInternalMeetingAnalysisHandler } from "../../src/backend/integrations/internal/meetingAnalysisHandler";

const secret = "test-internal-analysis-secret";
const meetingId = "11111111-1111-4111-8111-111111111111";

describe("POST /api/internal/meetings/:meetingId/analysis", () => {
  it("runs a manual analysis or recovery attempt with valid authentication", async () => {
    const processor = vi.fn().mockResolvedValue({ status: "completed", meetingId, attempt: 1 });
    const post = createInternalMeetingAnalysisHandler({ processor, secret });

    const response = await post(request(secret), context(meetingId));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "completed", meetingId, attempt: 1 });
    expect(processor).toHaveBeenCalledWith(meetingId, { manualRetry: true });
  });

  it("rejects missing or invalid authentication", async () => {
    const processor = vi.fn();
    const post = createInternalMeetingAnalysisHandler({ processor, secret });

    const missing = await post(request(), context(meetingId));
    const invalid = await post(request("wrong-secret"), context(meetingId));

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(processor).not.toHaveBeenCalled();
  });

  it("fails closed when the internal endpoint secret is not configured", async () => {
    const processor = vi.fn();
    const post = createInternalMeetingAnalysisHandler({ processor, secret: "" });

    const response = await post(request(), context(meetingId));

    expect(response.status).toBe(503);
    expect(processor).not.toHaveBeenCalled();
  });

  it("rejects an invalid meeting identifier before processing", async () => {
    const processor = vi.fn();
    const post = createInternalMeetingAnalysisHandler({ processor, secret });

    const response = await post(request(secret), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(processor).not.toHaveBeenCalled();
  });

  it("maps missing, conflicting, and failed analysis results", async () => {
    const processor = vi.fn()
      .mockResolvedValueOnce({ status: "not_found", meetingId, attempt: null })
      .mockResolvedValueOnce({ status: "already_processing", meetingId, attempt: 1 })
      .mockResolvedValueOnce({
        status: "failed",
        meetingId,
        attempts: 3,
        error: { code: "openai_timeout", message: "OpenAI request timed out." },
      });
    const post = createInternalMeetingAnalysisHandler({ processor, secret });

    expect((await post(request(secret), context(meetingId))).status).toBe(404);
    expect((await post(request(secret), context(meetingId))).status).toBe(409);
    expect((await post(request(secret), context(meetingId))).status).toBe(502);
  });
});

function request(token?: string): Request {
  return new Request(`https://anda.test/api/internal/meetings/${meetingId}/analysis`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function context(id: string) {
  return { params: Promise.resolve({ meetingId: id }) };
}
