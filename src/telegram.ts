import { config } from "./config";
import type { InlineKeyboardMarkup, ReplyMarkup, SendMessageOptions } from "./types";

interface TelegramResponseEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

async function telegramRequest<T>(method: string, body: BodyInit | Record<string, unknown>, isMultipart = false): Promise<T> {
  const response = await fetch(`${config.telegramApiBaseUrl}/${method}`, {
    method: "POST",
    headers: isMultipart ? undefined : { "content-type": "application/json" },
    body: isMultipart ? (body as BodyInit) : JSON.stringify(body),
  });

  const payload = (await response.json()) as TelegramResponseEnvelope<T>;
  if (!response.ok || !payload.ok) {
    const description = payload.description ?? `HTTP ${response.status}`;
    throw new Error(`Telegram API 오류 (${method}): ${description}`);
  }

  return payload.result as T;
}

export async function sendMessage(chatId: string, text: string, options: SendMessageOptions = {}): Promise<void> {
  const body = cleanObject({
    chat_id: chatId,
    text,
    parse_mode: options.parseMode,
    reply_markup: options.replyMarkup,
  });

  await telegramRequest("sendMessage", body);
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const body = cleanObject({
    callback_query_id: callbackQueryId,
    text,
  });

  await telegramRequest("answerCallbackQuery", body);
}

export async function sendDocument(
  chatId: string,
  fileName: string,
  content: Uint8Array,
  options: { caption?: string; replyMarkup?: ReplyMarkup } = {},
): Promise<void> {
  const formData = new FormData();
  formData.set("chat_id", chatId);
  formData.set("document", new Blob([content], { type: "text/csv;charset=utf-8" }), fileName);
  if (options.caption) {
    formData.set("caption", options.caption);
  }
  if (options.replyMarkup) {
    formData.set("reply_markup", JSON.stringify(options.replyMarkup));
  }

  await telegramRequest("sendDocument", formData, true);
}

export function isInlineKeyboardMarkup(replyMarkup: ReplyMarkup | undefined): replyMarkup is InlineKeyboardMarkup {
  return Boolean(replyMarkup && "inline_keyboard" in replyMarkup);
}
