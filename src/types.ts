export const REQUEST_STATUSES = ["요청", "수락", "거절", "취소", "무응답", "완료", "미이행"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUESTER_ALLOWED_COMMANDS = ["/start", "/help", "/request", "/my_requests", "/reason"] as const;
export const CAREGIVER_ALLOWED_COMMANDS = ["/start", "/help", "/menu", "/list", "/yearly", "/export_yearly"] as const;

export const CAREGIVER_REASON_STATUSES = ["거절", "취소", "무응답"] as const;
export type CaregiverReasonStatus = (typeof CAREGIVER_REASON_STATUSES)[number];

export const EXECUTION_STATUSES = ["완료", "미이행"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const SESSION_MODES = [
  "request_date_time",
  "request_place",
  "request_message",
  "approve",
  "caregiver_reason",
  "execution_note",
  "requester_reason",
  "year_summary",
  "year_export",
] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export type ChatId = string;
export type TelegramParseMode = "Markdown" | "MarkdownV2" | "HTML";

export interface VisitationRequestRow {
  id: number;
  sourceUpdateId: string;
  requesterChatId: ChatId;
  requesterName: string;
  requestedDate: string;
  requestedTime: string;
  requestedPlace: string;
  requestMessage: string;
  status: RequestStatus;
  approvedPlace: string;
  approvedTime: string;
  caregiverReason: string;
  requesterReason: string;
  executionNote: string;
  decisionByChatId: ChatId | null;
  decisionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionRow {
  chatId: ChatId;
  mode: SessionMode;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface KeyboardButton {
  text: string;
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButton[][];
  resize_keyboard: boolean;
}

export interface ReplyKeyboardRemove {
  remove_keyboard: true;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export type ReplyMarkup = ReplyKeyboardMarkup | ReplyKeyboardRemove | InlineKeyboardMarkup;

export interface SendMessageOptions {
  replyMarkup?: ReplyMarkup;
  parseMode?: TelegramParseMode;
}

export interface ParsedRequestArgs {
  requestedDate: string;
  requestedTime: string;
  requestedPlace: string;
  requestMessage: string;
}

export type CallbackAction =
  | { kind: "requester_menu_my_requests" }
  | { kind: "requester_view"; requestId: number }
  | { kind: "requester_reason"; requestId: number }
  | { kind: "menu_recent" }
  | { kind: "menu_year_summary" }
  | { kind: "menu_year_export" }
  | { kind: "view"; requestId: number }
  | { kind: "approve"; requestId: number }
  | { kind: "reason_status"; requestId: number; status: CaregiverReasonStatus }
  | { kind: "execution"; requestId: number; status: ExecutionStatus }
  | { kind: "invalid"; raw: string };

export type UpdateAcquireResult = "acquired" | "retried" | "completed" | "processing";

export type MutationResultKind = "updated" | "already_applied" | "not_found" | "forbidden" | "invalid_state";

export interface MutationResult {
  kind: MutationResultKind;
  row: VisitationRequestRow | null;
}

export interface CreateRequestResult {
  created: boolean;
  row: VisitationRequestRow;
}

export interface YearSummaryMessage {
  text: string;
  parseMode?: TelegramParseMode;
}

export interface CsvDocument {
  fileName: string;
  content: Uint8Array;
}
