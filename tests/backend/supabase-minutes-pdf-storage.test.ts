import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { meetingId } from "../helpers/meetingApproval";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";

describe("Supabase minutes PDF storage", () => {
  it("uploads a deterministic private PDF path and returns useful metadata", async () => {
    const bytes = new TextEncoder().encode("%PDF-test-content");
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({ Key: "stored" }));
    const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey, fetchImplementation });

    await expect(storage.storeUnsignedPdf({
      meetingId,
      documentVersion: 4,
      bytes,
      pageCount: 2,
    })).resolves.toEqual({
      path: `unsigned/${meetingId}/v4/minutes.pdf`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      pageCount: 2,
    });

    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(
      `${apiUrl}/storage/v1/object/meeting-minutes/unsigned/${meetingId}/v4/minutes.pdf`,
    );
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
        "x-upsert": "true",
      },
    });
    expect(Buffer.from(options.body as Buffer).equals(Buffer.from(bytes))).toBe(true);
  });

  it("returns a sanitised storage error without exposing response bodies", async () => {
    const storage = createSupabaseMinutesPdfStorage({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json(
        { message: "Bucket rejected upload." },
        { status: 500 },
      )),
    });
    await expect(storage.storeUnsignedPdf({
      meetingId,
      documentVersion: 4,
      bytes: new Uint8Array([1]),
      pageCount: 1,
    })).rejects.toMatchObject({
      code: "pdf_storage_failed",
      status: 500,
      message: "Bucket rejected upload.",
    });
  });

  it("loads the exact approved PDF bytes from the private storage bucket", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(bytes));
    const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey, fetchImplementation });

    await expect(storage.loadApprovedPdf(`unsigned/${meetingId}/v4/minutes.pdf`))
      .resolves.toEqual(bytes);
    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(
      `${apiUrl}/storage/v1/object/authenticated/meeting-minutes/unsigned/${meetingId}/v4/minutes.pdf`,
    );
    expect(options).toMatchObject({
      method: "GET",
      headers: {
        apikey: secretKey,
        authorization: `Bearer ${secretKey}`,
      },
    });
  });

  it("rejects empty approved PDF downloads", async () => {
    const storage = createSupabaseMinutesPdfStorage({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(new Response(new Uint8Array())),
    });
    await expect(storage.loadApprovedPdf(`unsigned/${meetingId}/v4/minutes.pdf`))
      .rejects.toMatchObject({
        code: "pdf_storage_empty_document",
        message: "The approved PDF stored in Supabase is empty.",
      });
  });

  it("stores the final signed PDF at a deterministic authoritative path", async () => {
    const bytes = new TextEncoder().encode("%PDF-signed-content");
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({ Key: "stored" }));
    const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey, fetchImplementation });

    await expect(storage.storeSignedPdf({
      meetingId,
      documentVersion: 4,
      bytes,
      pageCount: 3,
    })).resolves.toEqual({
      path: `signed/${meetingId}/v4/minutes-signed.pdf`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      pageCount: 3,
    });
    const [url] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(
      `${apiUrl}/storage/v1/object/meeting-minutes/signed/${meetingId}/v4/minutes-signed.pdf`,
    );
  });

  it("removes the temporary unsigned object through the Storage API", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([]));
    const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey, fetchImplementation });
    const path = `unsigned/${meetingId}/v4/minutes.pdf`;

    await storage.removeObject(path);
    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/storage/v1/object/meeting-minutes`);
    expect(options.method).toBe("DELETE");
    expect(JSON.parse(String(options.body))).toEqual({ prefixes: [path] });
  });

  it("creates short-lived private document access rather than a public URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T14:00:00.000Z"));
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      signedURL: "/storage/v1/object/sign/meeting-minutes/signed/file.pdf?token=test",
    }));
    const storage = createSupabaseMinutesPdfStorage({ apiUrl, secretKey, fetchImplementation });

    await expect(storage.createTemporaryDownload("signed/file.pdf", 300)).resolves.toEqual({
      url: `${apiUrl}/storage/v1/object/sign/meeting-minutes/signed/file.pdf?token=test`,
      expiresAt: "2026-07-20T14:05:00.000Z",
    });
    const [url, options] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/storage/v1/object/sign/meeting-minutes/signed/file.pdf`);
    expect(JSON.parse(String(options.body))).toEqual({ expiresIn: 300 });
    vi.useRealTimers();
  });
});
