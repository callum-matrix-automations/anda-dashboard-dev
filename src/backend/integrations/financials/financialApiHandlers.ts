import { z } from "zod";
import type { ServerActorResolver } from "../../auth/serverActor";
import { resolveServerActor } from "../../auth/serverActor";
import { FinancialRepositoryError } from "../../repositories/supabase/supabaseFinancialRepository";
import { FinancialFileStorageError } from "../../repositories/supabase/supabaseFinancialFileStorage";
import { FinancialServiceError, createFinancialService, financialService } from "../../services/financials/financialService";
import { apiError, apiValidationError, requireCurrentServerActor } from "../http/apiResponses";
import {
  FinancialFolderCreateRequestSchema,
  FinancialFolderUpdateRequestSchema,
  FinancialRecordListQuerySchema,
  FinancialRecordMetadataInputSchema,
  FinancialRecordUpdateRequestSchema,
  FinancialRecordVersionedRequestSchema,
} from "../../../shared/contracts/financial";

type FinancialService = ReturnType<typeof createFinancialService>;
type FolderContext = { params: Promise<{ folderId: string }> };
type RecordContext = { params: Promise<{ recordId: string }> };

interface Dependencies {
  service?: FinancialService;
  actorResolver?: ServerActorResolver;
}

const IdSchema = z.string().uuid();

export function createFinancialFolderListHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    try {
      return Response.json(await service.listFolders());
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialFolderCreateHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = FinancialFolderCreateRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The folder details are invalid.");
    try {
      const result = await service.createFolder(access.actor.profileId, parsed.data.name);
      if (result.status === "duplicate") {
        return apiError(409, "financial_folder_duplicate", "A folder with that name already exists.");
      }
      return Response.json(result.folder, { status: 201 });
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialFolderUpdateHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function PATCH(request: Request, context: FolderContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const folderId = await routeId(context, "folderId", "invalid_financial_folder_id");
    if (folderId instanceof Response) return folderId;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = FinancialFolderUpdateRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The folder update is invalid.");
    try {
      const result = await service.updateFolder({
        folderId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
        name: parsed.data.name,
      });
      if (result.status === "saved") return Response.json(result.folder);
      if (result.status === "not_found") return apiError(404, "financial_folder_not_found", "The folder was not found.");
      if (result.status === "duplicate") return apiError(409, "financial_folder_duplicate", "A folder with that name already exists.", { currentVersion: result.version });
      if (result.status === "system_folder") return apiError(409, "financial_system_folder", "Default annual folders cannot be renamed.", { currentVersion: result.version });
      return versionConflict(result.version, "folder");
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialRecordListHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const url = new URL(request.url);
    const parsed = FinancialRecordListQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      folderId: url.searchParams.get("folderId") || undefined,
      year: url.searchParams.get("year") || undefined,
      month: url.searchParams.get("month") || undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error, "The financial record filters are invalid.");
    try {
      return Response.json(await service.listRecords(parsed.data));
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialRecordUploadHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "invalid_request", "Upload one financial record using multipart form data.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(400, "invalid_request", "Choose a financial record to upload.");
    const parsed = FinancialRecordMetadataInputSchema.safeParse({
      folderId: form.get("folderId"),
      displayName: form.get("displayName"),
      recordYear: Number(form.get("recordYear")),
      recordMonth: Number(form.get("recordMonth")),
      description: normalizeOptionalFormText(form.get("description")),
    });
    if (!parsed.success) return apiValidationError(parsed.error, "The financial record details are invalid.");
    try {
      const result = await service.uploadRecord({
        actorProfileId: access.actor.profileId,
        fileName: file.name,
        declaredMimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        record: parsed.data,
      });
      if (result.status === "saved") return Response.json(result.record, { status: 201 });
      if (result.status === "folder_not_found") return apiError(404, "financial_folder_not_found", "The selected folder was not found.");
      return apiError(409, "financial_folder_year_mismatch", "The record year must match the selected annual folder.");
    } catch (error) {
      return uploadError(error);
    }
  };
}

export function createFinancialRecordDetailHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request, context: RecordContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const recordId = await routeId(context, "recordId", "invalid_financial_record_id");
    if (recordId instanceof Response) return recordId;
    try {
      const record = await service.getRecord(recordId);
      return record ? Response.json(record) : apiError(404, "financial_record_not_found", "The financial record was not found.");
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialRecordUpdateHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function PATCH(request: Request, context: RecordContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const recordId = await routeId(context, "recordId", "invalid_financial_record_id");
    if (recordId instanceof Response) return recordId;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = FinancialRecordUpdateRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The financial record update is invalid.");
    try {
      const result = await service.updateRecord({
        recordId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
        record: parsed.data.record,
      });
      return recordMutationResponse(result);
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialRecordArchiveHandler(archived: boolean, {
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request, context: RecordContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const recordId = await routeId(context, "recordId", "invalid_financial_record_id");
    if (recordId instanceof Response) return recordId;
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = FinancialRecordVersionedRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The financial record version is invalid.");
    try {
      const result = await service.setRecordArchived({
        recordId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
        archived,
      });
      return recordMutationResponse(result);
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createFinancialRecordContentHandler({
  service = financialService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request, context: RecordContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const recordId = await routeId(context, "recordId", "invalid_financial_record_id");
    if (recordId instanceof Response) return recordId;
    try {
      const file = await service.loadFile(recordId);
      if (!file) return apiError(404, "financial_record_not_found", "The financial record was not found.");
      return new Response(Buffer.from(file.bytes), {
        headers: {
          "content-type": file.metadata.mimeType,
          "content-length": String(file.metadata.sizeBytes),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata.originalFileName)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return unavailable(error);
    }
  };
}

async function routeId<T extends "folderId" | "recordId">(
  context: { params: Promise<Record<T, string>> },
  key: T,
  code: string,
) {
  const parsed = IdSchema.safeParse((await context.params)[key]);
  return parsed.success ? parsed.data : apiError(400, code, "The requested identifier is invalid.");
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return apiError(400, "invalid_json", "The request body must be valid JSON.");
  }
}

function normalizeOptionalFormText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordMutationResponse(result: Awaited<ReturnType<FinancialService["updateRecord"]>>) {
  if (result.status === "saved") return Response.json(result.record);
  if (result.status === "not_found") return apiError(404, "financial_record_not_found", "The financial record was not found.");
  if (result.status === "conflict") return versionConflict(result.version, "record");
  if (result.status === "archived") return apiError(409, "financial_record_archived", "Restore the financial record before editing it.", { currentVersion: result.version });
  if (result.status === "folder_not_found") return apiError(404, "financial_folder_not_found", "The selected folder was not found.");
  if (result.status === "folder_year_mismatch") return apiError(409, "financial_folder_year_mismatch", "The record year must match the selected annual folder.", { currentVersion: result.version });
  return apiError(409, "invalid_financial_record_state", "The financial record is already in the requested state.", { currentVersion: result.version });
}

function versionConflict(version: number, subject: string) {
  return apiError(409, "version_conflict", `The financial ${subject} changed since it was opened. Reload and try again.`, {
    currentVersion: version,
  });
}

function uploadError(error: unknown) {
  if (error instanceof FinancialServiceError) {
    if (error.code === "financial_file_too_large") return apiError(413, error.code, error.message);
    if (error.code === "unsupported_financial_file_type") return apiError(415, error.code, error.message);
    if (error.code === "invalid_financial_file" || error.code === "invalid_financial_filename") {
      return apiError(400, error.code, error.message);
    }
  }
  return unavailable(error);
}

function unavailable(error: unknown) {
  if (
    error instanceof FinancialRepositoryError
    || error instanceof FinancialFileStorageError
    || error instanceof FinancialServiceError
  ) {
    return apiError(503, error.code, "Financial records are temporarily unavailable.");
  }
  return apiError(503, "financial_service_unavailable", "Financial records are temporarily unavailable.");
}
