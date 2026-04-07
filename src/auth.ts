import { config } from "./config";
import { CAREGIVER_ALLOWED_COMMANDS, REQUESTER_ALLOWED_COMMANDS, type ChatId } from "./types";

export function isCaregiver(chatId: ChatId): boolean {
  return chatId === config.adminChatId;
}

export function isAllowedCommandForRole(caregiver: boolean, text: string): boolean {
  const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const allowed = caregiver ? CAREGIVER_ALLOWED_COMMANDS : REQUESTER_ALLOWED_COMMANDS;
  return allowed.includes(command as (typeof allowed)[number]);
}

export function isAllowedCommand(chatId: ChatId, text: string): boolean {
  return isAllowedCommandForRole(isCaregiver(chatId), text);
}
