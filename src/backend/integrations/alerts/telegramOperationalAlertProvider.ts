import { z } from "zod";
import type { OperationalAlertProvider } from "./operationalAlertProvider";
import type { OperationalAlertDeliveryClaim } from "../../../shared/contracts/operationalAlerts";

interface Options {
  botToken?: string;
  chatId?: string;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
}

const TelegramResponseSchema = z.object({ ok: z.boolean() }).passthrough();

export class TelegramOperationalAlertError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "TelegramOperationalAlertError";
    this.code = code;
  }
}

export function createTelegramOperationalAlertProvider({
  botToken,
  chatId,
  apiBaseUrl = "https://api.telegram.org",
  fetchImplementation = globalThis.fetch,
}: Options = {}): OperationalAlertProvider {
  const configuredToken = botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;

  return {
    isConfigured() {
      return Boolean(
        configuredToken?.trim()
        && /^[0-9]+:[A-Za-z0-9_-]+$/u.test(configuredToken.trim())
        && configuredChatId?.trim(),
      );
    },
    async send(alert) {
      const token = configuredToken?.trim();
      const destination = configuredChatId?.trim();
      if (!token || !destination) {
        throw new TelegramOperationalAlertError(
          "Telegram operational alerts are not configured.",
          "telegram_not_configured",
        );
      }
      if (!/^[0-9]+:[A-Za-z0-9_-]+$/u.test(token)) {
        throw new TelegramOperationalAlertError(
          "Telegram bot token is invalid.",
          "telegram_configuration_invalid",
        );
      }

      let response: Response;
      try {
        response = await fetchImplementation(
          new URL(`/bot${token}/sendMessage`, apiBaseUrl),
          {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              chat_id: destination,
              text: formatTelegramOperationalAlert(alert),
              disable_notification: false,
            }),
          },
        );
      } catch (error) {
        throw new TelegramOperationalAlertError(
          "Telegram could not be reached.",
          "telegram_request_failed",
          { cause: error },
        );
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // The status code below remains authoritative when Telegram returns no JSON.
      }
      if (!response.ok) {
        throw new TelegramOperationalAlertError(
          "Telegram rejected the operational alert.",
          response.status === 429 ? "telegram_rate_limited" : `telegram_http_${response.status}`,
        );
      }
      const parsed = TelegramResponseSchema.safeParse(body);
      if (!parsed.success || !parsed.data.ok) {
        throw new TelegramOperationalAlertError(
          "Telegram returned an invalid delivery response.",
          "telegram_invalid_response",
        );
      }
    },
  };
}

export function formatTelegramOperationalAlert(alert: OperationalAlertDeliveryClaim) {
  return [
    "ANDA operational alert",
    `Stage: ${alert.stage}`,
    `Failure: ${alert.failureCode}`,
    alert.workflowStatus ? `Status: ${alert.workflowStatus}` : null,
    alert.meetingId ? `Meeting ID: ${alert.meetingId}` : null,
    alert.entityRef ? `Reference: ${alert.entityRef}` : null,
    `Occurred: ${alert.occurredAt}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export const telegramOperationalAlertProvider = createTelegramOperationalAlertProvider();
