import type { ChatId } from "./types";

export interface AppConfig {
  telegramBotToken: string;
  adminChatId: ChatId;
  appBaseUrl: string;
  webhookUrl: string;
  databaseUrl: string;
  telegramApiBaseUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`환경변수 ${name} 이(가) 필요합니다.`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

function loadConfig(): AppConfig {
  const telegramBotToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const adminChatId = requireEnv("ADMIN_CHAT_ID");
  const appBaseUrl = normalizeBaseUrl(requireEnv("APP_BASE_URL"));
  const databaseUrl = requireEnv("DATABASE_URL");
  const webhookUrl = new URL("/api/telegram", `${appBaseUrl}/`).toString();

  return {
    telegramBotToken,
    adminChatId,
    appBaseUrl,
    webhookUrl,
    databaseUrl,
    telegramApiBaseUrl: `https://api.telegram.org/bot${telegramBotToken}`,
  };
}

export const config = Object.freeze(loadConfig());
