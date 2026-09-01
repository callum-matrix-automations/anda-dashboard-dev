import { describe, expect, it, vi } from "vitest";
import { createSupabaseFinancialRepository, FinancialRepositoryError } from "../../src/backend/repositories/supabase/supabaseFinancialRepository";
import { financialFolder, financialListResponse, financialRecord, financialRecordId } from "../helpers/financialFixtures";

describe("Supabase financial repository", () => {
  it("maps folder and filtered record RPC calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ folders: [financialFolder()] }))
      .mockResolvedValueOnce(jsonResponse(financialListResponse()));
    const repository = createSupabaseFinancialRepository({
      apiUrl: "https://supabase.test",
      secretKey: "test-secret",
      fetchImplementation: fetchMock,
    });

    await expect(repository.listFolders()).resolves.toEqual({ folders: [financialFolder()] });
    await expect(repository.listRecords({
      q: "statement", folderId: financialFolder().id, year: 2026, month: 8,
      status: "active", limit: 25, offset: 0,
    })).resolves.toEqual(financialListResponse());

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/rest/v1/rpc/list_financial_records");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      p_query: "statement", p_folder_id: financialFolder().id, p_year: 2026, p_month: 8, p_status: "active",
    });
  });

  it("parses record mutations and missing details", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "saved", record: financialRecord({ version: 2 }) }))
      .mockResolvedValueOnce(jsonResponse(null));
    const repository = createSupabaseFinancialRepository({ apiUrl: "https://supabase.test", secretKey: "test-secret", fetchImplementation: fetchMock });

    await expect(repository.setRecordArchived({
      recordId: financialRecordId,
      expectedVersion: 1,
      actorProfileId: financialRecord().updatedBy,
      archived: true,
    })).resolves.toMatchObject({ status: "saved", record: { version: 2 } });
    await expect(repository.getRecord(financialRecordId)).resolves.toBeNull();
  });

  it("rejects malformed Supabase responses", async () => {
    const repository = createSupabaseFinancialRepository({
      apiUrl: "https://supabase.test",
      secretKey: "test-secret",
      fetchImplementation: vi.fn().mockResolvedValue(jsonResponse({ folders: [{ nope: true }] })),
    });
    await expect(repository.listFolders()).rejects.toBeInstanceOf(FinancialRepositoryError);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
