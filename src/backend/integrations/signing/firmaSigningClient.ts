import { z } from "zod";
import type {
  CreateSigningRequestInput,
  SigningRequestProvider,
  SigningRequestReference,
} from "./signingRequestProvider";
import {
  FirmaRequestDetailsSchema,
  SignedDocumentSchema,
  type FirmaRequestDetails,
} from "../../../shared/contracts/meetingSigning";

const DEFAULT_BASE_URL = "https://api.firma.dev/functions/v1/signing-request-api/";
const DEFAULT_API_VERSION = "1";
const COMPLETED_DOCUMENT_INITIAL_DELAY_MS = 5_000;
const COMPLETED_DOCUMENT_RETRY_DELAY_MS = 5_000;
const COMPLETED_DOCUMENT_MAX_ATTEMPTS = 4;

const FirmaCreatedRequestSchema = z.object({
  id: z.string().trim().min(1),
}).passthrough();

const FirmaListedRequestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string(),
  recipients: z.array(z.object({
    email: z.string(),
  }).passthrough()).default([]),
}).passthrough();

const FirmaListSchema = z.object({
  results: z.array(FirmaListedRequestSchema),
}).passthrough();

const FirmaRecipientResponseSchema = z.object({
  id: z.string().optional(),
  signing_request_user_id: z.string().optional(),
  email: z.string(),
  finished_on: z.string().nullable().optional(),
  finished_date: z.string().nullable().optional(),
  date_finished: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  declined_on: z.string().nullable().optional(),
  declined_at: z.string().nullable().optional(),
}).passthrough();
type FirmaRecipientResponse = z.infer<typeof FirmaRecipientResponseSchema>;

const FirmaRequestStatusSchema = z.object({
  id: z.string().optional(),
  status: z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      status: z.string().optional(),
      sent: z.boolean().optional(),
      finished: z.boolean().optional(),
      cancelled: z.boolean().optional(),
      declined: z.boolean().optional(),
      expired: z.boolean().optional(),
    }).passthrough(),
  ]),
  recipients: z.array(FirmaRecipientResponseSchema).optional(),
  users: z.array(FirmaRecipientResponseSchema).optional(),
  finished_on: z.string().nullable().optional(),
  finished_date: z.string().nullable().optional(),
  date_finished: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  timestamps: z.object({
    created_on: z.string().nullable().optional(),
    sent_on: z.string().nullable().optional(),
    finished_on: z.string().nullable().optional(),
    cancelled_on: z.string().nullable().optional(),
    declined_on: z.string().nullable().optional(),
    last_changed_on: z.string().nullable().optional(),
    last_signing_action_on: z.string().nullable().optional(),
  }).passthrough().optional(),
}).passthrough();

const FirmaDownloadSchema = z.object({
  status: z.string().optional(),
  is_partial: z.boolean().default(false),
  download_url: z.string().url(),
  generated_at: z.string().nullable().optional(),
}).passthrough();

const FirmaErrorSchema = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
}).passthrough();

interface FirmaSigningClientOptions {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  fetchImplementation?: typeof fetch;
  waitImplementation?: (milliseconds: number) => Promise<void>;
}

export class FirmaSigningClientError extends Error {
  readonly status?: number;
  readonly code: string;

  constructor(message: string, { status, code = "firma_request_failed", cause }: {
    status?: number;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "FirmaSigningClientError";
    this.status = status;
    this.code = code;
  }
}

export function createFirmaSigningClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  apiVersion = DEFAULT_API_VERSION,
  fetchImplementation = globalThis.fetch,
  waitImplementation = delay,
}: FirmaSigningClientOptions = {}): SigningRequestProvider {
  const configuration = () => resolveConfiguration({
    apiKey,
    baseUrl,
    apiVersion,
    fetchImplementation,
  });

  async function findRequest(
    requestName: string,
    signerEmail: string,
  ): Promise<SigningRequestReference | null> {
    const resolved = configuration();
    const url = new URL("signing-requests", resolved.baseUrl);
    url.searchParams.set("name", requestName);
    url.searchParams.set("signer_email", signerEmail);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "10");
    const response = await fetchResponse(resolved, url, { method: "GET" }, "firma_lookup_failed");
    const body = await readJson(response);
    if (!response.ok) throw responseError(response, body, "Firma could not look up the signing request.", "firma_lookup_failed");
    const parsed = FirmaListSchema.safeParse(body);
    if (!parsed.success) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request list.", {
        code: "firma_invalid_response",
        cause: parsed.error,
      });
    }
    const email = signerEmail.toLocaleLowerCase("en");
    const exactMatches = parsed.data.results.filter((request) => (
      request.name === requestName
      && request.recipients.some((recipient) => recipient.email.toLocaleLowerCase("en") === email)
    ));
    if (exactMatches.length > 1) {
      throw new FirmaSigningClientError("Firma returned more than one request for the approved PDF.", {
        code: "firma_ambiguous_request",
      });
    }
    return exactMatches[0] ? { id: exactMatches[0].id } : null;
  }

  async function createRequest(input: CreateSigningRequestInput): Promise<SigningRequestReference> {
    const resolved = configuration();
    const url = new URL("signing-requests", resolved.baseUrl);
    let response: Response;
    try {
      response = await fetchResponse(resolved, url, {
        method: "POST",
        body: JSON.stringify({
          name: input.requestName,
          description: input.description,
          document: Buffer.from(input.document).toString("base64"),
          recipients: [{
            id: "temp_treasurer",
            first_name: input.recipient.firstName,
            last_name: input.recipient.lastName,
            email: input.recipient.email,
            designation: "Signer",
            order: 1,
          }],
          anchor_tags: [{
            anchor_string: input.signatureAnchor,
            type: "signature",
            recipient_id: "temp_treasurer",
            width: 30,
            height: 6,
            occurrence: 1,
            ignore_if_not_present: false,
            remove_anchor_text: true,
            case_sensitive: true,
            match_whole_word: true,
          }],
          settings: {
            use_signing_order: false,
            send_signing_email: true,
            allow_download: true,
            attach_pdf_on_finish: true,
          },
        }),
      }, "firma_create_failed");
    } catch (error) {
      if (error instanceof FirmaSigningClientError && error.code === "firma_network_error") {
        const reconciled = await findRequest(input.requestName, input.recipient.email);
        if (reconciled) return reconciled;
      }
      throw error;
    }

    const body = await readJson(response);
    if (!response.ok) throw responseError(response, body, "Firma could not create the signing request.", "firma_create_failed");
    const parsed = FirmaCreatedRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request.", {
        code: "firma_invalid_response",
        cause: parsed.error,
      });
    }
    return { id: parsed.data.id };
  }

  async function sendRequest(externalRequestId: string): Promise<void> {
    const resolved = configuration();
    const encodedId = encodeURIComponent(externalRequestId);
    const url = new URL(`signing-requests/${encodedId}/send`, resolved.baseUrl);
    let response: Response;
    try {
      response = await fetchResponse(resolved, url, {
        method: "POST",
        body: JSON.stringify({}),
      }, "firma_send_failed");
    } catch (error) {
      if (
        error instanceof FirmaSigningClientError
        && error.code === "firma_network_error"
        && await requestHasBeenSent(resolved, externalRequestId)
      ) return;
      throw error;
    }

    if (response.ok) return;
    const body = await readJson(response);
    if (response.status === 409 && await requestHasBeenSent(resolved, externalRequestId)) return;
    throw responseError(response, body, "Firma could not send the signing request.", "firma_send_failed");
  }

  async function getRequest(externalRequestId: string): Promise<FirmaRequestDetails> {
    const resolved = configuration();
    const encodedId = encodeURIComponent(externalRequestId);
    const detailUrl = new URL(`signing-requests/${encodedId}`, resolved.baseUrl);
    const detailResponse = await fetchResponse(
      resolved,
      detailUrl,
      { method: "GET" },
      "firma_status_failed",
    );
    const detailBody = await readJson(detailResponse);
    if (!detailResponse.ok) {
      throw responseError(
        detailResponse,
        detailBody,
        "Firma could not retrieve the signing request.",
        "firma_status_failed",
      );
    }
    const detail = FirmaRequestStatusSchema.safeParse(detailBody);
    if (!detail.success) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request status.", {
        code: "firma_invalid_response",
        cause: detail.error,
      });
    }

    let recipients = detail.data.recipients ?? detail.data.users ?? [];
    if (recipients.length === 0) {
      const usersUrl = new URL(`signing-requests/${encodedId}/users`, resolved.baseUrl);
      const usersResponse = await fetchResponse(
        resolved,
        usersUrl,
        { method: "GET" },
        "firma_recipients_failed",
      );
      const usersBody = await readJson(usersResponse);
      if (!usersResponse.ok) {
        throw responseError(
          usersResponse,
          usersBody,
          "Firma could not retrieve the signing recipients.",
          "firma_recipients_failed",
        );
      }
      const parsedUsers = z.union([
        z.array(FirmaRecipientResponseSchema),
        z.object({ results: z.array(FirmaRecipientResponseSchema) }).passthrough(),
        z.object({ users: z.array(FirmaRecipientResponseSchema) }).passthrough(),
      ]).safeParse(usersBody);
      if (!parsedUsers.success) {
        throw new FirmaSigningClientError("Firma returned invalid signing recipients.", {
          code: "firma_invalid_response",
          cause: parsedUsers.error,
        });
      }
      const userResult = parsedUsers.data;
      if (Array.isArray(userResult)) {
        recipients = userResult as FirmaRecipientResponse[];
      } else if ("results" in userResult && Array.isArray(userResult.results)) {
        recipients = userResult.results as FirmaRecipientResponse[];
      } else {
        recipients = (userResult as { users: FirmaRecipientResponse[] }).users;
      }
    }

    const rawStatus = normalizeFirmaStatus(detail.data.status);
    if (!rawStatus) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request status.", {
        code: "firma_invalid_response",
      });
    }

    return FirmaRequestDetailsSchema.parse({
      id: detail.data.id ?? externalRequestId,
      status: rawStatus.trim().toLocaleLowerCase("en"),
      recipients: recipients.map((recipient) => ({
        id: recipient.signing_request_user_id ?? recipient.id,
        email: recipient.email,
        finishedAt: recipient.finished_on
          ?? recipient.finished_date
          ?? recipient.date_finished
          ?? recipient.completed_at
          ?? recipient.signed_at
          ?? null,
        declinedAt: recipient.declined_on ?? recipient.declined_at ?? null,
      })),
      completedAt: detail.data.finished_on
        ?? detail.data.finished_date
        ?? detail.data.date_finished
        ?? detail.data.completed_at
        ?? detail.data.timestamps?.finished_on
        ?? null,
    });
  }

  async function downloadCompletedDocument(externalRequestId: string) {
    const resolved = configuration();
    await waitImplementation(COMPLETED_DOCUMENT_INITIAL_DELAY_MS);

    for (let attempt = 1; attempt <= COMPLETED_DOCUMENT_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await downloadCompletedDocumentAttempt(resolved, externalRequestId);
      } catch (error) {
        if (attempt === COMPLETED_DOCUMENT_MAX_ATTEMPTS || !isRetryableCompletedDocumentError(error)) {
          throw error;
        }
        await waitImplementation(COMPLETED_DOCUMENT_RETRY_DELAY_MS);
      }
    }

    throw new FirmaSigningClientError("Firma could not prepare the signed PDF.", {
      code: "firma_download_failed",
    });
  }

  async function downloadCompletedDocumentAttempt(
    resolved: ResolvedFirmaConfiguration,
    externalRequestId: string,
  ) {
    const encodedId = encodeURIComponent(externalRequestId);
    const url = new URL(`signing-requests/${encodedId}/download`, resolved.baseUrl);
    const response = await fetchResponse(
      resolved,
      url,
      { method: "GET" },
      "firma_download_failed",
    );
    const body = await readJson(response);
    if (!response.ok) {
      throw responseError(
        response,
        body,
        "Firma could not prepare the signed PDF.",
        response.status === 503 ? "firma_document_not_ready" : "firma_download_failed",
      );
    }
    const parsed = FirmaDownloadSchema.safeParse(body);
    if (!parsed.success) {
      throw new FirmaSigningClientError("Firma returned invalid signed PDF metadata.", {
        code: "firma_invalid_response",
        cause: parsed.error,
      });
    }

    let documentResponse: Response;
    try {
      documentResponse = await resolved.fetchImplementation(parsed.data.download_url, {
        method: "GET",
        headers: { accept: "application/pdf" },
      });
    } catch (error) {
      throw new FirmaSigningClientError("Firma's signed PDF could not be downloaded.", {
        code: "firma_network_error",
        cause: error,
      });
    }
    if (!documentResponse.ok) {
      throw new FirmaSigningClientError("Firma's signed PDF could not be downloaded.", {
        code: "firma_download_failed",
        status: documentResponse.status,
      });
    }
    const bytes = new Uint8Array(await documentResponse.arrayBuffer());
    return SignedDocumentSchema.parse({
      bytes,
      generatedAt: parsed.data.generated_at ?? null,
      isPartial: parsed.data.is_partial,
    });
  }

  async function cancelRequest(externalRequestId: string, reason: string): Promise<void> {
    const resolved = configuration();
    const encodedId = encodeURIComponent(externalRequestId);
    const url = new URL(`signing-requests/${encodedId}/cancel`, resolved.baseUrl);
    const response = await fetchResponse(resolved, url, {
      method: "POST",
      body: JSON.stringify({
        reason: reason.trim().slice(0, 500),
        notify_signers: true,
      }),
    }, "firma_cancel_failed");
    if (response.ok) return;
    const body = await readJson(response);
    if (response.status === 409) {
      const request = await getRequest(externalRequestId);
      if (request.status === "cancelled" || request.status === "declined") return;
    }
    throw responseError(
      response,
      body,
      "Firma could not cancel the signing request.",
      "firma_cancel_failed",
    );
  }

  return {
    findRequest,
    createRequest,
    sendRequest,
    getRequest,
    downloadCompletedDocument,
    cancelRequest,
  };
}

interface ResolvedFirmaConfiguration {
  apiKey: string;
  baseUrl: URL;
  apiVersion: string;
  fetchImplementation: typeof fetch;
}

function resolveConfiguration({
  apiKey,
  baseUrl,
  apiVersion,
  fetchImplementation,
}: Required<Pick<FirmaSigningClientOptions, "baseUrl" | "apiVersion">>
  & Pick<FirmaSigningClientOptions, "apiKey" | "fetchImplementation">): ResolvedFirmaConfiguration {
  const resolvedApiKey = apiKey ?? process.env.FIRMA_API_KEY;
  if (!resolvedApiKey?.trim()) {
    throw new FirmaSigningClientError("Firma signing is not configured.", {
      code: "firma_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new FirmaSigningClientError("A fetch implementation is required for Firma signing.", {
      code: "fetch_not_configured",
    });
  }
  const resolvedBaseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return {
    apiKey: resolvedApiKey.trim(),
    baseUrl: resolvedBaseUrl,
    apiVersion,
    fetchImplementation,
  };
}

async function fetchResponse(
  configuration: ResolvedFirmaConfiguration,
  url: URL,
  init: RequestInit,
  operationCode: string,
): Promise<Response> {
  try {
    return await configuration.fetchImplementation(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: configuration.apiKey,
        "content-type": "application/json",
        "x-api-version": configuration.apiVersion,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new FirmaSigningClientError("Firma could not be reached.", {
      code: "firma_network_error",
      cause: new Error(operationCode, { cause: error }),
    });
  }
}

async function requestHasBeenSent(
  configuration: ResolvedFirmaConfiguration,
  externalRequestId: string,
): Promise<boolean> {
  const encodedId = encodeURIComponent(externalRequestId);
  const url = new URL(`signing-requests/${encodedId}`, configuration.baseUrl);
  let response: Response;
  try {
    response = await fetchResponse(configuration, url, { method: "GET" }, "firma_status_failed");
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const parsed = FirmaRequestStatusSchema.safeParse(await readJson(response));
  if (!parsed.success) return false;
  const rawStatus = normalizeFirmaStatus(parsed.data.status);
  return rawStatus !== null && ["sent", "in_progress", "finished"].includes(rawStatus);
}

function normalizeFirmaStatus(status: z.infer<typeof FirmaRequestStatusSchema>["status"]): string | null {
  if (typeof status === "string") {
    const value = status.trim().toLocaleLowerCase("en");
    return value || null;
  }
  const namedStatus = status.name ?? status.status;
  if (namedStatus?.trim()) return namedStatus.trim().toLocaleLowerCase("en");
  if (status.finished) return "finished";
  if (status.declined) return "declined";
  if (status.cancelled) return "cancelled";
  if (status.expired) return "expired";
  if (status.sent) return "in_progress";
  return "not_sent";
}

function isRetryableCompletedDocumentError(error: unknown): boolean {
  if (!(error instanceof FirmaSigningClientError)) return true;
  if (error.code === "firma_document_not_ready" || error.code === "firma_network_error") return true;
  if (error.code !== "firma_download_failed") return false;
  if (error.status === undefined) return true;
  return [400, 404, 409, 423, 425, 429].includes(error.status) || error.status >= 500;
}

function responseError(
  response: Response,
  body: unknown,
  fallback: string,
  code: string,
): FirmaSigningClientError {
  const parsed = FirmaErrorSchema.safeParse(body);
  const providerMessage = parsed.success
    ? parsed.data.message ?? parsed.data.error
    : undefined;
  const message = providerMessage?.trim()
    ? providerMessage.trim().slice(0, 2_000)
    : fallback;
  return new FirmaSigningClientError(message, { status: response.status, code });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export const firmaSigningClient = createFirmaSigningClient();
