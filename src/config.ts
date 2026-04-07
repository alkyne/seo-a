import type { ChatId } from "./types";

export interface AppConfig {
  telegramBotToken: string;
  adminChatId: ChatId;
  deploymentHost: string | null;
  webhookUrl: string | null;
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

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeDeploymentHost(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function loadConfig(): AppConfig {
  const telegramBotToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const adminChatId = requireEnv("ADMIN_CHAT_ID");
  const databaseUrl = requireEnv("DATABASE_URL");
  const deploymentHostRaw = readOptionalEnv("VERCEL_URL");
  const deploymentHost = deploymentHostRaw ? normalizeDeploymentHost(deploymentHostRaw) : null;
  const webhookUrl = deploymentHost ? `https://${deploymentHost}/api/telegram` : null;

  return {
    telegramBotToken,
    adminChatId,
    deploymentHost,
    webhookUrl,
    databaseUrl,
    telegramApiBaseUrl: `https://api.telegram.org/bot${telegramBotToken}`,
  };
}

export const config = Object.freeze(loadConfig());
