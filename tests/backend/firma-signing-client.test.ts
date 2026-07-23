import { describe, expect, it, vi } from "vitest";
import {
  createFirmaSigningClient,
  FirmaSigningClientError,
} from "../../src/backend/integrations/signing/firmaSigningClient";
import type { CreateSigningRequestInput } from "../../src/backend/integrations/signing/signingRequestProvider";
import { TREASURER_SIGNATURE_ANCHOR } from "../../src/backend/services/pdf/renderMinutesPdf";

const baseUrl = "https://firma.example.test/functions/v1/signing-request-api/";
const apiKey = "firma-test-key";

describe("Firma signing client", () => {
  it("creates a draft request containing the exact PDF, signer, and signature anchor", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({ id: "firma-request-1" }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });

    await expect(client.createRequest(requestInput())).resolves.toEqual({ id: "firma-request-1" });

    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${baseUrl}signing-requests`);
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/json",
        "x-api-version": "1",
      },
    });
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "ANDA meeting 1 v4",
      description: "Approved minutes.",
      document: Buffer.from(requestInput().document).toString("base64"),
      recipients: [{
        id: "temp_treasurer",
        first_name: "Test",
        last_name: "Treasurer",
        email: "treasurer@example.test",
        designation: "Signer",
        order: 1,
      }],
      anchor_tags: [{
        anchor_string: TREASURER_SIGNATURE_ANCHOR,
        type: "signature",
        recipient_id: "temp_treasurer",
        occurrence: 1,
        ignore_if_not_present: false,
        remove_anchor_text: true,
      }],
      settings: {
        send_signing_email: true,
        allow_download: true,
        attach_pdf_on_finish: true,
      },
    });
    expect(body).not.toHaveProperty("template_id");
  });

  it("finds only an exact request-name and signer-email match", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      results: [
        { id: "wrong-name", name: "ANDA meeting 1", recipients: [{ email: "treasurer@example.test" }] },
        { id: "wrong-signer", name: "ANDA meeting 1 v4", recipients: [{ email: "other@example.test" }] },
        { id: "exact", name: "ANDA meeting 1 v4", recipients: [{ email: "TREASURER@example.test" }] },
      ],
    }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });

    await expect(client.findRequest("ANDA meeting 1 v4", "treasurer@example.test"))
      .resolves.toEqual({ id: "exact" });
    const [url] = fetchImplementation.mock.calls[0] as [URL];
    expect(url.searchParams.get("name")).toBe("ANDA meeting 1 v4");
    expect(url.searchParams.get("signer_email")).toBe("treasurer@example.test");
  });

  it("refuses an ambiguous provider lookup instead of choosing a request", async () => {
    const result = { name: "ANDA meeting 1 v4", recipients: [{ email: "treasurer@example.test" }] };
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({
        results: [{ id: "one", ...result }, { id: "two", ...result }],
      })),
    });
    await expect(client.findRequest(result.name, "treasurer@example.test")).rejects.toMatchObject({
      code: "firma_ambiguous_request",
    });
  });

  it("reconciles an ambiguous create network failure without creating a duplicate", async () => {
    const fetchImplementation = vi.fn()
      .mockRejectedValueOnce(new Error("socket closed after provider accepted the request"))
      .mockResolvedValueOnce(Response.json({
        results: [{
          id: "already-created",
          name: "ANDA meeting 1 v4",
          recipients: [{ email: "treasurer@example.test" }],
        }],
      }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });

    await expect(client.createRequest(requestInput())).resolves.toEqual({ id: "already-created" });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect((fetchImplementation.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect((fetchImplementation.mock.calls[1]![1] as RequestInit).method).toBe("GET");
  });

  it("sends the draft request through the API", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });

    await expect(client.sendRequest("request/with spaces")).resolves.toBeUndefined();
    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${baseUrl}signing-requests/request%2Fwith%20spaces/send`);
    expect(options.method).toBe("POST");
  });

  it.each([
    ["network uncertainty", () => { throw new Error("connection reset"); }],
    ["provider conflict", () => Response.json({ message: "already sent" }, { status: 409 })],
  ])("reconciles %s when Firma reports that the request is already in progress", async (_name, firstResult) => {
    const fetchImplementation = vi.fn()
      .mockImplementationOnce(firstResult)
      .mockResolvedValueOnce(Response.json({ status: "in_progress" }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });

    await expect(client.sendRequest("firma-request-1")).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect((fetchImplementation.mock.calls[1]![0] as URL).href)
      .toBe(`${baseUrl}signing-requests/firma-request-1`);
  });

  it("returns a sanitised provider error and never includes the API key", async () => {
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json(
        { message: "Firma rejected the request." },
        { status: 422 },
      )),
    });
    const failure = await client.createRequest(requestInput()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FirmaSigningClientError);
    expect(failure).toMatchObject({
      code: "firma_create_failed",
      status: 422,
      message: "Firma rejected the request.",
    });
    expect(String(failure)).not.toContain(apiKey);
  });

  it("fails before making a request when Firma is not configured", async () => {
    const client = createFirmaSigningClient({ apiKey: "", baseUrl, fetchImplementation: vi.fn() });
    await expect(client.createRequest(requestInput())).rejects.toMatchObject({
      code: "firma_not_configured",
    });
  });

  it("normalizes request status and retrieves recipients from the users endpoint", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        id: "firma-request-1",
        status: { name: "finished" },
        finished_on: "2026-07-20T12:00:00.000Z",
      }))
      .mockResolvedValueOnce(Response.json({ users: [{
        signing_request_user_id: "recipient-1",
        email: "treasurer@example.test",
        finished_on: "2026-07-20T12:00:00.000Z",
      }] }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });
    await expect(client.getRequest("firma/request 1")).resolves.toEqual({
      id: "firma-request-1",
      status: "finished",
      recipients: [{
        id: "recipient-1",
        email: "treasurer@example.test",
        finishedAt: "2026-07-20T12:00:00.000Z",
        declinedAt: null,
      }],
      completedAt: "2026-07-20T12:00:00.000Z",
    });
    expect((fetchImplementation.mock.calls[0]![0] as URL).href)
      .toBe(`${baseUrl}signing-requests/firma%2Frequest%201`);
    expect((fetchImplementation.mock.calls[1]![0] as URL).href)
      .toBe(`${baseUrl}signing-requests/firma%2Frequest%201/users`);
  });

  it("normalizes Firma's live boolean status flags and nested timestamps", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        id: "firma-request-live",
        status: {
          sent: true,
          finished: false,
          cancelled: false,
          declined: false,
          expired: false,
        },
        timestamps: {
          created_on: "2026-07-19T23:56:35.241954+00:00",
          sent_on: "2026-07-19T23:56:36.097+00:00",
          finished_on: null,
          cancelled_on: null,
          declined_on: null,
        },
      }))
      .mockResolvedValueOnce(Response.json({ results: [{
        id: "recipient-live",
        email: "treasurer@example.test",
        finished_on: null,
        declined_on: null,
      }] }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });
    await expect(client.getRequest("firma-request-live")).resolves.toEqual({
      id: "firma-request-live",
      status: "in_progress",
      recipients: [{
        id: "recipient-live",
        email: "treasurer@example.test",
        finishedAt: null,
        declinedAt: null,
      }],
      completedAt: null,
    });
  });

  it.each([
    ["finished", { sent: true, finished: true, cancelled: false, declined: false, expired: false }],
    ["declined", { sent: true, finished: false, cancelled: false, declined: true, expired: false }],
    ["cancelled", { sent: true, finished: false, cancelled: true, declined: false, expired: false }],
    ["expired", { sent: true, finished: false, cancelled: false, declined: false, expired: true }],
  ])("normalizes the live %s status flag", async (expectedStatus, status) => {
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({
        id: "firma-request-live",
        status,
        timestamps: {
          finished_on: expectedStatus === "finished" ? "2026-07-20T12:00:00.000Z" : null,
        },
        recipients: [{
          id: "recipient-live",
          email: "treasurer@example.test",
          finished_on: expectedStatus === "finished" ? "2026-07-20T12:00:00.000Z" : null,
          declined_on: expectedStatus === "declined" ? "2026-07-20T12:00:00.000Z" : null,
        }],
      })),
    });
    await expect(client.getRequest("firma-request-live")).resolves.toMatchObject({
      status: expectedStatus,
    });
  });

  it("downloads the completed PDF from Firma's short-lived signed URL", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nsigned\n%%EOF");
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "finished",
        is_partial: false,
        download_url: "https://downloads.example.test/signed.pdf?token=short-lived",
        generated_at: "2026-07-20T12:00:00.000Z",
      }))
      .mockResolvedValueOnce(new Response(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation, waitImplementation });
    await expect(client.downloadCompletedDocument("firma-request-1")).resolves.toEqual({
      bytes: pdf,
      generatedAt: "2026-07-20T12:00:00.000Z",
      isPartial: false,
    });
    const [, downloadOptions] = fetchImplementation.mock.calls[1] as [string, RequestInit];
    expect(downloadOptions.headers).toEqual({ accept: "application/pdf" });
    expect(JSON.stringify(downloadOptions)).not.toContain(apiKey);
    expect(waitImplementation).toHaveBeenCalledOnce();
    expect(waitImplementation).toHaveBeenCalledWith(5_000);
  });

  it("waits and retries three times while Firma is still generating the signed PDF", async () => {
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const fetchImplementation = vi.fn().mockImplementation(() => Promise.resolve(Response.json(
      { message: "PDF is still generating" },
      { status: 503 },
    )));
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation,
      waitImplementation,
    });
    await expect(client.downloadCompletedDocument("firma-request-1")).rejects.toMatchObject({
      code: "firma_document_not_ready",
      status: 503,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(waitImplementation).toHaveBeenCalledTimes(4);
    expect(waitImplementation).toHaveBeenNthCalledWith(1, 5_000);
    expect(waitImplementation).toHaveBeenNthCalledWith(4, 5_000);
  });

  it("recovers when Firma reports finished before its completed PDF is ready", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\ndelayed signed document\n%%EOF");
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const fetchImplementation = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(Response.json(
        { message: "Signing request has not been sent yet" },
        { status: 400 },
      )))
      .mockImplementationOnce(() => Promise.resolve(Response.json(
        { message: "Signing request has not been sent yet" },
        { status: 400 },
      )))
      .mockImplementationOnce(() => Promise.resolve(Response.json(
        { message: "PDF is still generating" },
        { status: 503 },
      )))
      .mockResolvedValueOnce(Response.json({
        status: "finished",
        is_partial: false,
        download_url: "https://downloads.example.test/delayed-signed.pdf",
        generated_at: "2026-07-20T12:00:20.000Z",
      }))
      .mockResolvedValueOnce(new Response(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }));
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation,
      waitImplementation,
    });

    await expect(client.downloadCompletedDocument("firma-request-1")).resolves.toEqual({
      bytes: pdf,
      generatedAt: "2026-07-20T12:00:20.000Z",
      isPartial: false,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(waitImplementation).toHaveBeenCalledTimes(4);
    expect(waitImplementation.mock.calls).toEqual([[5_000], [5_000], [5_000], [5_000]]);
  });

  it("does not retry a non-transient completed-document authorization failure", async () => {
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json(
      { message: "Not authorized" },
      { status: 401 },
    ));
    const client = createFirmaSigningClient({
      apiKey,
      baseUrl,
      fetchImplementation,
      waitImplementation,
    });

    await expect(client.downloadCompletedDocument("firma-request-1")).rejects.toMatchObject({
      code: "firma_download_failed",
      status: 401,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(waitImplementation).toHaveBeenCalledOnce();
  });

  it("cancels a request with the mandatory correction reason", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createFirmaSigningClient({ apiKey, baseUrl, fetchImplementation });
    await expect(client.cancelRequest("firma/request 1", "Correct the vote.")).resolves.toBeUndefined();
    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${baseUrl}signing-requests/firma%2Frequest%201/cancel`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      reason: "Correct the vote.",
      notify_signers: true,
    });
  });
});

function requestInput(): CreateSigningRequestInput {
  return {
    requestName: "ANDA meeting 1 v4",
    description: "Approved minutes.",
    document: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
    recipient: {
      firstName: "Test",
      lastName: "Treasurer",
      email: "treasurer@example.test",
    },
    signatureAnchor: TREASURER_SIGNATURE_ANCHOR,
  };
}
