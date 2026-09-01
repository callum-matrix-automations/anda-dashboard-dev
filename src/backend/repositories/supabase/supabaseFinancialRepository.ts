import { z } from "zod";
import type { FinancialRepository } from "../financials/financialRepository";
import {
  FinancialFolderListResponseSchema,
  FinancialFolderSchema,
  FinancialRecordListQuerySchema,
  FinancialRecordListResponseSchema,
  FinancialRecordMimeTypeSchema,
  FinancialRecordSchema,
} from "../../../shared/contracts/financial";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

interface Options {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const FolderCreateResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), folder: FinancialFolderSchema }).strict(),
  z.object({ status: z.literal("duplicate") }).strict(),
]);

const FolderUpdateResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), folder: FinancialFolderSchema }).strict(),
  z.object({ status: z.literal("not_found"), version: z.null() }).strict(),
  z.object({
    status: z.enum(["conflict", "system_folder", "duplicate"]),
    version: z.number().int().positive(),
  }).strict(),
]);

const RecordAttachResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: FinancialRecordSchema }).strict(),
  z.object({ status: z.enum(["folder_not_found", "folder_year_mismatch"]) }).strict(),
]);

const RecordMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: FinancialRecordSchema }).strict(),
  z.object({ status: z.literal("not_found"), version: z.null() }).strict(),
  z.object({
    status: z.enum(["conflict", "archived", "invalid_state", "folder_not_found", "folder_year_mismatch"]),
    version: z.number().int().positive(),
  }).strict(),
]);

const FileMetadataSchema = z.object({
  storagePath: z.string().trim().min(1),
  originalFileName: z.string().trim().min(1),
  mimeType: FinancialRecordMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
}).strict();

export class FinancialRepositoryError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, { code = "financial_repository_failed", status, cause }: {
    code?: string;
    status?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "FinancialRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createSupabaseFinancialRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: Options = {}): FinancialRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey) {
      throw new FinancialRepositoryError("Supabase financial records persistence is not configured.", {
        code: "supabase_not_configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImplementation(new URL(`/rest/v1/rpc/${name}`, resolvedApiUrl), {
        method: "POST",
        headers: supabaseServerHeaders(resolvedSecretKey, {
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new FinancialRepositoryError("Supabase financial records request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new FinancialRepositoryError(
        details.success ? details.data.message : `Supabase returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code ?? "supabase_response_failed" : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async listFolders() {
      return parse(FinancialFolderListResponseSchema, await callRpc("list_financial_folders", {}), "folder list");
    },
    async createFolder(actorProfileId, name) {
      return parse(FolderCreateResultSchema, await callRpc("create_financial_folder", {
        p_actor_id: actorProfileId,
        p_name: name,
      }), "folder creation result");
    },
    async updateFolder(input) {
      return parse(FolderUpdateResultSchema, await callRpc("update_financial_folder", {
        p_folder_id: input.folderId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_name: input.name,
      }), "folder update result");
    },
    async listRecords(query) {
      const input = FinancialRecordListQuerySchema.parse(query);
      return parse(FinancialRecordListResponseSchema, await callRpc("list_financial_records", {
        p_query: input.q,
        p_folder_id: input.folderId,
        p_year: input.year,
        p_month: input.month,
        p_status: input.status,
        p_limit: input.limit,
        p_offset: input.offset,
      }), "financial record list");
    },
    async getRecord(recordId) {
      const response = await callRpc("financial_record_json", { p_record_id: recordId });
      if (response === null) return null;
      return parse(FinancialRecordSchema, response, "financial record detail");
    },
    async attachRecord(input) {
      return parse(RecordAttachResultSchema, await callRpc("attach_financial_record", {
        p_record_id: input.recordId,
        p_actor_id: input.actorProfileId,
        p_folder_id: input.record.folderId,
        p_storage_path: input.storagePath,
        p_display_name: input.record.displayName,
        p_original_file_name: input.originalFileName,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_record_year: input.record.recordYear,
        p_record_month: input.record.recordMonth,
        p_description: input.record.description,
      }), "financial record attachment result");
    },
    async updateRecord(input) {
      return parse(RecordMutationResultSchema, await callRpc("update_financial_record", {
        p_record_id: input.recordId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_record: input.record,
      }), "financial record update result");
    },
    async setRecordArchived(input) {
      return parse(RecordMutationResultSchema, await callRpc("set_financial_record_archived", {
        p_record_id: input.recordId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_archived: input.archived,
      }), "financial record archive result");
    },
    async getFileMetadata(recordId) {
      const response = await callRpc("get_financial_record_file_metadata", { p_record_id: recordId });
      if (response === null) return null;
      return parse(FileMetadataSchema, response, "financial file metadata");
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new FinancialRepositoryError(`Supabase returned an invalid ${description}.`, {
      code: "invalid_supabase_response",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const supabaseFinancialRepository = createSupabaseFinancialRepository();
