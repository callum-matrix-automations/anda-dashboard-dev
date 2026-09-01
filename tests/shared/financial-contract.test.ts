import { describe, expect, it } from "vitest";
import {
  FinancialFolderCreateRequestSchema,
  FinancialRecordListQuerySchema,
  FinancialRecordMetadataInputSchema,
} from "../../src/shared/contracts/financial";
import { financialMetadata } from "../helpers/financialFixtures";

describe("financial record contracts", () => {
  it("accepts valid month metadata and normalizes folder names", () => {
    expect(FinancialRecordMetadataInputSchema.parse(financialMetadata())).toMatchObject({ recordYear: 2026, recordMonth: 8 });
    expect(FinancialFolderCreateRequestSchema.parse({ name: "  Tax returns  " })).toEqual({ name: "Tax returns" });
  });

  it("rejects invalid month, year, folder and display-name values", () => {
    expect(FinancialRecordMetadataInputSchema.safeParse(financialMetadata({ recordMonth: 13 })).success).toBe(false);
    expect(FinancialRecordMetadataInputSchema.safeParse(financialMetadata({ recordYear: 1800 })).success).toBe(false);
    expect(FinancialRecordMetadataInputSchema.safeParse(financialMetadata({ folderId: "not-a-folder" })).success).toBe(false);
    expect(FinancialRecordMetadataInputSchema.safeParse(financialMetadata({ displayName: "" })).success).toBe(false);
  });

  it("applies active-list defaults and validates filters", () => {
    expect(FinancialRecordListQuerySchema.parse({})).toEqual({
      q: "", folderId: null, year: null, month: null, status: "active", limit: 25, offset: 0,
    });
    expect(FinancialRecordListQuerySchema.safeParse({ month: "0" }).success).toBe(false);
  });
});
