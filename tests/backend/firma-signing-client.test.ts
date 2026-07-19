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
