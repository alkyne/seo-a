import { isAllowedCommand, isCaregiver } from "./auth";
import {
  beginProcessedUpdate,
  clearChatSession,
  createRequest,
  getChatSession,
  getRecentRequests,
  getRequest,
  getRequestsForRequester,
  getYearRequests,
  markProcessedUpdateCompleted,
  markProcessedUpdateFailed,
  saveChatSession,
  saveRequesterReason,
  transitionApprove,
  transitionCaregiverReason,
  transitionExecutionStatus,
} from "./db";
import {
  buildCaregiverActions,
  buildCaregiverHomeKeyboard,
  buildCaregiverMenu,
  buildCaregiverStartText,
  buildKeyboardRemove,
  buildRequesterActions,
  buildRequesterHomeKeyboard,
  buildRequesterStartText,
  buildYearCsv,
  buildYearSummaryMessage,
  formatRequest,
} from "./format";
import {
  extractCommand,
  parseApprovalInput,
  parseDatetimeFlexible,
  parseRequestArgs,
  parseYear,
  splitWithMax,
} from "./parser";
import { answerCallbackQuery, sendDocument, sendMessage } from "./telegram";
import { config } from "./config";
import type {
  ChatId,
  ChatSessionRow,
  MutationResult,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  VisitationRequestRow,
} from "./types";

function toChatId(value: number): ChatId {
  return String(value);
}

function getRequesterName(message: TelegramMessage, chatId: ChatId): string {
  const from = message.from;
  const parts = [from?.first_name, from?.last_name].filter(Boolean);
  return parts.join(" ").trim() || `chat:${chatId}`;
}

function getUpdateKind(update: TelegramUpdate): string {
  if (update.callback_query) {
    return "callback_query";
  }
  if (update.message?.text) {
    return "message";
  }
  return "ignored";
}

function getUpdateChatId(update: TelegramUpdate): ChatId | undefined {
  if (update.message) {
    return toChatId(update.message.chat.id);
  }
  if (update.callback_query?.message) {
    return toChatId(update.callback_query.message.chat.id);
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

function getUpdateDebugContext(update: TelegramUpdate): Record<string, unknown> {
  return {
    updateId: update.update_id,
    kind: getUpdateKind(update),
    chatId: getUpdateChatId(update) ?? null,
    messageText: update.message?.text ?? null,
    callbackData: update.callback_query?.data ?? null,
  };
}

async function notifyUnhandledUpdateError(update: TelegramUpdate, errorMessage: string): Promise<void> {
  const chatId = getUpdateChatId(update);
  if (!chatId) {
    return;
  }

  try {
    await sendMessage(chatId, `오류: ${errorMessage}`);
  } catch (notifyError) {
    console.error("사용자 오류 메시지 전송 실패", {
      chatId,
      error: toErrorMessage(notifyError),
      stack: getErrorStack(notifyError),
    });
  }
}

function parsePythonStyleInt(text: string): number {
  if (!/^[+-]?\d+$/.test(text)) {
    throw new Error(`invalid literal for int() with base 10: '${text}'`);
  }

  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`invalid literal for int() with base 10: '${text}'`);
  }
  return parsed;
}

function afterFirstColon(data: string): string {
  const index = data.indexOf(":");
  return index === -1 ? "" : data.slice(index + 1);
}

function parseThreePartCallback(data: string): [string, string, string] {
  const first = data.indexOf(":");
  const second = first === -1 ? -1 : data.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    const count = first === -1 ? 1 : 2;
    throw new Error(`not enough values to unpack (expected 3, got ${count})`);
  }
  return [data.slice(0, first), data.slice(first + 1, second), data.slice(second + 1)];
}

async function sendStart(chatId: ChatId): Promise<void> {
  if (isCaregiver(chatId)) {
    await sendMessage(chatId, buildCaregiverStartText(), {
      replyMarkup: buildCaregiverHomeKeyboard(),
    });
    return;
  }

  await sendMessage(chatId, buildRequesterStartText(), {
    replyMarkup: buildRequesterHomeKeyboard(),
  });
}

async function sendRequesterReceipt(row: VisitationRequestRow): Promise<void> {
  await sendMessage(row.requesterChatId, `요청이 접수되었습니다.\n\n${formatRequest(row)}`, {
    replyMarkup: buildRequesterActions(row.id),
  });
}

async function notifyCaregiverOfNewRequest(row: VisitationRequestRow): Promise<void> {
  await sendMessage(config.adminChatId, `비양육자의 면접교섭 요청이 도착했습니다.\n\n${formatRequest(row)}`, {
    replyMarkup: buildCaregiverActions(row.id),
  });
}

async function sendRequestRows(chatId: ChatId, rows: VisitationRequestRow[], caregiver: boolean): Promise<void> {
  for (const row of rows) {
    await sendMessage(chatId, formatRequest(row), {
      replyMarkup: caregiver ? buildCaregiverActions(row.id) : buildRequesterActions(row.id),
    });
  }
}

async function sendYearSummary(chatId: ChatId, year: string): Promise<void> {
  const rows = await getYearRequests(year);
  const message = buildYearSummaryMessage(year, rows);
  await sendMessage(chatId, message.text, {
    parseMode: message.parseMode,
  });
}

async function sendYearCsv(chatId: ChatId, year: string): Promise<void> {
  const rows = await getYearRequests(year);
  if (rows.length === 0) {
    await sendMessage(chatId, "해당 연도 기록이 없습니다.");
    return;
  }

  const csv = buildYearCsv(year, rows);
  await sendDocument(chatId, csv.fileName, csv.content);
}

async function sendHomeKeyboardPrompt(chatId: ChatId): Promise<void> {
  await sendMessage(chatId, "아래 버튼으로 계속 이용할 수 있습니다.", {
    replyMarkup: isCaregiver(chatId) ? buildCaregiverHomeKeyboard() : buildRequesterHomeKeyboard(),
  });
}

async function handleRequestCreationFromCommand(message: TelegramMessage, updateId: string): Promise<void> {
  const chatId = toChatId(message.chat.id);
  if (isCaregiver(chatId)) {
    await sendMessage(chatId, "양육자 계정에서는 /request 를 사용하지 않습니다.");
    return;
  }

  const text = message.text?.trim() ?? "";
  if (text === "/request") {
    await saveChatSession(chatId, "request_date_time");
    await sendMessage(chatId, "요청 일시를 입력하세요.\n예: 2026-04-20 14:00 또는 2026.04.20 14시", {
      replyMarkup: buildKeyboardRemove(),
    });
    return;
  }

  try {
    const parsed = parseRequestArgs(text);
    const result = await createRequest({
      sourceUpdateId: updateId,
      requesterChatId: chatId,
      requesterName: getRequesterName(message, chatId),
      requestedDate: parsed.requestedDate,
      requestedTime: parsed.requestedTime,
      requestedPlace: parsed.requestedPlace,
      requestMessage: parsed.requestMessage,
    });

    await sendRequesterReceipt(result.row);
    if (result.created) {
      await notifyCaregiverOfNewRequest(result.row);
    }
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function handleMyRequests(chatId: ChatId): Promise<void> {
  if (isCaregiver(chatId)) {
    await sendMessage(chatId, "양육자는 /list 를 사용하세요.");
    return;
  }

  const rows = await getRequestsForRequester(chatId, 10);
  if (rows.length === 0) {
    await sendMessage(chatId, "내 요청 기록이 없습니다.");
    return;
  }

  await sendRequestRows(chatId, rows, false);
}

async function handleReasonCommand(message: TelegramMessage): Promise<void> {
  const chatId = toChatId(message.chat.id);
  if (isCaregiver(chatId)) {
    await sendMessage(chatId, "양육자는 버튼을 통해 사유를 입력하세요.");
    return;
  }

  const parts = splitWithMax(message.text ?? "", 3);
  if (parts.length < 3) {
    await sendMessage(chatId, "형식: /reason 요청ID 사유");
    return;
  }

  try {
    const requestId = parsePythonStyleInt(parts[1] ?? "");
    const reason = parts[2] ?? "";
    const result = await saveRequesterReason(requestId, chatId, reason);

    if (result.kind === "not_found") {
      await sendMessage(chatId, "해당 요청을 찾을 수 없습니다.");
      return;
    }
    if (result.kind === "forbidden") {
      await sendMessage(chatId, "본인 요청에만 사유를 남길 수 있습니다.");
      return;
    }

    if (!result.row) {
      throw new Error("비양육자 사유 저장에 실패했습니다.");
    }

    await sendMessage(chatId, `비양육자 사유가 저장되었습니다.\n\n${formatRequest(result.row)}`, {
      replyMarkup: buildRequesterActions(requestId),
    });

    if (result.kind === "updated") {
      await sendMessage(config.adminChatId, `비양육자 사유가 추가되었습니다.\n\n${formatRequest(result.row)}`, {
        replyMarkup: buildCaregiverActions(requestId),
      });
    }
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function handleMenuCommand(chatId: ChatId): Promise<void> {
  if (!isCaregiver(chatId)) {
    return;
  }

  await sendMessage(chatId, "양육자 메뉴를 선택하세요.", {
    replyMarkup: buildCaregiverMenu(),
  });
}

async function handleListCommand(chatId: ChatId): Promise<void> {
  if (!isCaregiver(chatId)) {
    return;
  }

  const rows = await getRecentRequests(10);
  if (rows.length === 0) {
    await sendMessage(chatId, "기록이 없습니다.");
    return;
  }

  await sendRequestRows(chatId, rows, true);
}

async function handleYearlyCommand(chatId: ChatId, text: string): Promise<void> {
  if (!isCaregiver(chatId)) {
    return;
  }

  const parts = splitWithMax(text, 2);
  if (parts.length !== 2) {
    await sendMessage(chatId, "형식: /yearly YYYY");
    return;
  }

  try {
    const year = parseYear(parts[1] ?? "");
    await sendYearSummary(chatId, year);
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function handleExportYearlyCommand(chatId: ChatId, text: string): Promise<void> {
  if (!isCaregiver(chatId)) {
    return;
  }

  const parts = splitWithMax(text, 2);
  if (parts.length !== 2) {
    await sendMessage(chatId, "형식: /export_yearly YYYY");
    return;
  }

  try {
    const year = parseYear(parts[1] ?? "");
    await sendYearCsv(chatId, year);
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function rejectUnknownCommand(chatId: ChatId, text: string): Promise<void> {
  if (isAllowedCommand(chatId, text)) {
    return;
  }

  if (isCaregiver(chatId)) {
    await sendMessage(chatId, "양육자 명령만 사용할 수 있습니다. /help 를 입력해 확인하세요.");
    return;
  }

  await sendMessage(
    chatId,
    "비양육자 사용 가능 명령은 /request, /my_requests, /reason 입니다.\n예: /request 2026-04-20 14:00 경주역 점심 후 카페 희망",
  );
}

async function handleHomeButtons(chatId: ChatId, text: string): Promise<void> {
  if (isCaregiver(chatId)) {
    if (text === "양육자 메뉴") {
      await handleMenuCommand(chatId);
      return;
    }
    if (text === "최근 요청 보기") {
      await handleListCommand(chatId);
      return;
    }
    if (text === "연별 요약") {
      await saveChatSession(chatId, "year_summary");
      await sendMessage(chatId, "연도를 입력하세요. 예: 2026");
      return;
    }
    if (text === "연별 CSV") {
      await saveChatSession(chatId, "year_export");
      await sendMessage(chatId, "연도를 입력하세요. 예: 2026");
      return;
    }
    return;
  }

  if (text === "요청하기") {
    await saveChatSession(chatId, "request_date_time");
    await sendMessage(chatId, "요청 일시를 입력하세요.\n예: 2026-04-20 14:00 또는 2026.04.20 14시", {
      replyMarkup: buildKeyboardRemove(),
    });
    return;
  }
  if (text === "내 요청 보기") {
    await handleMyRequests(chatId);
    return;
  }
  if (text === "사유 남기기") {
    await sendMessage(chatId, "형식: /reason 요청ID 사유");
  }
}

async function handleMutationOutcome(
  chatId: ChatId,
  result: MutationResult,
  successMessage: string,
  requesterNotification: (row: VisitationRequestRow) => Promise<void>,
): Promise<void> {
  if (result.kind === "not_found") {
    await clearChatSession(chatId);
    await sendMessage(chatId, "해당 요청을 찾을 수 없습니다.");
    return;
  }

  if (!result.row) {
    throw new Error("요청 처리 결과를 확인할 수 없습니다.");
  }

  await requesterNotification(result.row);
  await sendMessage(chatId, `${successMessage}\n\n${formatRequest(result.row)}`, {
    replyMarkup: buildCaregiverActions(result.row.id),
  });
  await sendHomeKeyboardPrompt(chatId);
  await clearChatSession(chatId);
}

async function handlePendingText(
  chatId: ChatId,
  session: ChatSessionRow,
  message: TelegramMessage,
  updateId: string,
): Promise<void> {
  const text = message.text?.trim() ?? "";

  try {
    switch (session.mode) {
      case "request_date_time": {
        const parsed = parseDatetimeFlexible(text);
        await saveChatSession(chatId, "request_place", {
          requestedDate: parsed.requestedDate,
          requestedTime: parsed.requestedTime,
        });
        await sendMessage(chatId, "장소를 입력하세요. 예: 경주역 2번 출구");
        return;
      }

      case "request_place": {
        const requestedDate = String(session.payload.requestedDate ?? "");
        const requestedTime = String(session.payload.requestedTime ?? "");
        await saveChatSession(chatId, "request_message", {
          requestedDate,
          requestedTime,
          requestedPlace: text,
        });
        await sendMessage(chatId, "요청 메시지를 입력하세요. 없으면 '없음'이라고 입력하세요.");
        return;
      }

      case "request_message": {
        const result = await createRequest({
          sourceUpdateId: updateId,
          requesterChatId: chatId,
          requesterName: getRequesterName(message, chatId),
          requestedDate: String(session.payload.requestedDate ?? ""),
          requestedTime: String(session.payload.requestedTime ?? ""),
          requestedPlace: String(session.payload.requestedPlace ?? ""),
          requestMessage: text === "없음" ? "" : text,
        });

        await sendRequesterReceipt(result.row);
        if (result.created) {
          await notifyCaregiverOfNewRequest(result.row);
        }
        await sendHomeKeyboardPrompt(chatId);
        await clearChatSession(chatId);
        return;
      }

      case "approve": {
        const requestId = Number(session.payload.requestId);
        const parsed = parseApprovalInput(text);
        const result = await transitionApprove(requestId, chatId, parsed.approvedPlace, parsed.approvedTime);
        await handleMutationOutcome(
          chatId,
          result,
          "수락 및 전달 완료",
          async (row) => {
            await sendMessage(
              row.requesterChatId,
              `면접교섭 요청이 수락되었습니다.\n\n확정장소: ${parsed.approvedPlace}\n확정시간: ${parsed.approvedTime}\n요청 ID: ${requestId}`,
              {
                replyMarkup: buildRequesterActions(requestId),
              },
            );
          },
        );
        return;
      }

      case "caregiver_reason": {
        const requestId = Number(session.payload.requestId);
        const status = String(session.payload.status ?? "");
        const result = await transitionCaregiverReason(requestId, chatId, status, text);
        await handleMutationOutcome(
          chatId,
          result,
          "상태 및 양육자 사유 저장 완료",
          async (row) => {
            await sendMessage(
              row.requesterChatId,
              `면접교섭 요청 상태가 변경되었습니다.\n\n상태: ${status}\n양육자 사유: ${text}\n요청 ID: ${requestId}`,
              {
                replyMarkup: buildRequesterActions(requestId),
              },
            );
          },
        );
        return;
      }

      case "execution_note": {
        const requestId = Number(session.payload.requestId);
        const status = String(session.payload.status ?? "");
        const result = await transitionExecutionStatus(requestId, chatId, status, text);
        await handleMutationOutcome(
          chatId,
          result,
          "상태 및 실행 메모 저장 완료",
          async (row) => {
            await sendMessage(
              row.requesterChatId,
              `면접교섭 기록이 업데이트되었습니다.\n\n상태: ${status}\n실행메모: ${text}\n요청 ID: ${requestId}`,
              {
                replyMarkup: buildRequesterActions(requestId),
              },
            );
          },
        );
        return;
      }

      case "requester_reason": {
        const requestId = Number(session.payload.requestId);
        const existing = await getRequest(requestId);
        if (!existing || existing.requesterChatId !== chatId) {
          await sendMessage(chatId, "본인 요청에만 사유를 남길 수 있습니다.");
          await clearChatSession(chatId);
          return;
        }

        const result = await saveRequesterReason(requestId, chatId, text);
        if (!result.row) {
          throw new Error("비양육자 사유 저장에 실패했습니다.");
        }

        await sendMessage(chatId, `비양육자 사유 저장 완료\n\n${formatRequest(result.row)}`, {
          replyMarkup: buildRequesterActions(requestId),
        });
        if (result.kind === "updated") {
          await sendMessage(config.adminChatId, `비양육자 사유가 추가되었습니다.\n\n${formatRequest(result.row)}`, {
            replyMarkup: buildCaregiverActions(requestId),
          });
        }
        await sendHomeKeyboardPrompt(chatId);
        await clearChatSession(chatId);
        return;
      }

      case "year_summary": {
        const year = parseYear(text);
        await sendYearSummary(chatId, year);
        await sendHomeKeyboardPrompt(chatId);
        await clearChatSession(chatId);
        return;
      }

      case "year_export": {
        const year = parseYear(text);
        await sendYearCsv(chatId, year);
        await sendHomeKeyboardPrompt(chatId);
        await clearChatSession(chatId);
        return;
      }
    }
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function handleMessage(update: TelegramUpdate, message: TelegramMessage): Promise<void> {
  const chatId = toChatId(message.chat.id);
  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const command = extractCommand(text);
  if (command) {
    switch (command) {
      case "/start":
      case "/help":
        await sendStart(chatId);
        return;
      case "/request":
        await handleRequestCreationFromCommand(message, String(update.update_id));
        return;
      case "/my_requests":
        await handleMyRequests(chatId);
        return;
      case "/reason":
        await handleReasonCommand(message);
        return;
      case "/menu":
        await handleMenuCommand(chatId);
        return;
      case "/list":
        await handleListCommand(chatId);
        return;
      case "/yearly":
        await handleYearlyCommand(chatId, text);
        return;
      case "/export_yearly":
        await handleExportYearlyCommand(chatId, text);
        return;
      default:
        await rejectUnknownCommand(chatId, text);
        return;
    }
  }

  const session = await getChatSession(chatId);
  if (session) {
    await handlePendingText(chatId, session, message, String(update.update_id));
    return;
  }

  await handleHomeButtons(chatId, text);
}

async function handleRequesterView(query: TelegramCallbackQuery, requestId: number): Promise<void> {
  if (!query.message) {
    return;
  }

  const chatId = toChatId(query.message.chat.id);
  const row = await getRequest(requestId);
  if (!row) {
    await sendMessage(chatId, "기록이 없습니다.");
    return;
  }

  if (isCaregiver(chatId) || row.requesterChatId === chatId) {
    await sendMessage(chatId, formatRequest(row), {
      replyMarkup: isCaregiver(chatId) ? buildCaregiverActions(requestId) : buildRequesterActions(requestId),
    });
    return;
  }
}

async function handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
  if (!query.message) {
    return;
  }

  const chatId = toChatId(query.message.chat.id);
  const data = query.data ?? "";
  await answerCallbackQuery(query.id);

  try {
    if (data === "requester_menu:my_requests") {
      if (isCaregiver(chatId)) {
        await sendMessage(chatId, "양육자는 /list 를 사용하세요.");
        return;
      }
      await handleMyRequests(chatId);
      return;
    }

    if (data.startsWith("requester_view:")) {
      const requestId = parsePythonStyleInt(afterFirstColon(data));
      await handleRequesterView(query, requestId);
      return;
    }

    if (data.startsWith("requester_reason:")) {
      const requestId = parsePythonStyleInt(afterFirstColon(data));
      const row = await getRequest(requestId);
      if (!row) {
        await sendMessage(chatId, "기록이 없습니다.");
        return;
      }
      if (row.requesterChatId !== chatId) {
        await sendMessage(chatId, "본인 요청에만 사유를 남길 수 있습니다.");
        return;
      }

      await saveChatSession(chatId, "requester_reason", { requestId });
      await sendMessage(chatId, "비양육자 사유를 보내주세요.");
      return;
    }

    if (!isCaregiver(chatId)) {
      await sendMessage(chatId, "양육자만 이 버튼을 사용할 수 있습니다.");
      return;
    }

    if (data === "menu:recent") {
      await handleListCommand(chatId);
      return;
    }

    if (data === "menu:year_summary") {
      await saveChatSession(chatId, "year_summary");
      await sendMessage(chatId, "요약할 연도를 보내주세요. 예: 2026");
      return;
    }

    if (data === "menu:year_export") {
      await saveChatSession(chatId, "year_export");
      await sendMessage(chatId, "내보낼 연도를 보내주세요. 예: 2026");
      return;
    }

    if (data.startsWith("view:")) {
      const requestId = parsePythonStyleInt(afterFirstColon(data));
      const row = await getRequest(requestId);
      if (row) {
        await sendMessage(chatId, formatRequest(row), {
          replyMarkup: buildCaregiverActions(requestId),
        });
      }
      return;
    }

    if (data.startsWith("approve:")) {
      const requestId = parsePythonStyleInt(afterFirstColon(data));
      await saveChatSession(chatId, "approve", { requestId });
      await sendMessage(chatId, "수락 정보를 보내주세요. 예: 경주역 2번 출구 14:00 또는 경주역 2번 출구 | 14:00");
      return;
    }

    if (data.startsWith("reason_status:")) {
      const [, requestIdText, status] = parseThreePartCallback(data);
      const requestId = parsePythonStyleInt(requestIdText);
      await saveChatSession(chatId, "caregiver_reason", { requestId, status });
      await sendMessage(chatId, `양육자 사유를 보내주세요. 상태: ${status}`);
      return;
    }

    if (data.startsWith("execution:")) {
      const [, requestIdText, status] = parseThreePartCallback(data);
      const requestId = parsePythonStyleInt(requestIdText);
      await saveChatSession(chatId, "execution_note", { requestId, status });
      await sendMessage(chatId, `실행 메모를 보내주세요. 상태: ${status}`);
      return;
    }
  } catch (error) {
    await sendMessage(chatId, `오류: ${toErrorMessage(error)}`);
  }
}

async function dispatchUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message?.text) {
    await handleMessage(update, update.message);
  }
}

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ ok: false, error: "invalid-json" }, { status: 400 });
  }

  if (!Number.isInteger(update.update_id)) {
    return Response.json({ ok: false, error: "invalid-update" }, { status: 400 });
  }

  const updateId = String(update.update_id);
  const acquireResult = await beginProcessedUpdate(updateId, getUpdateKind(update), getUpdateChatId(update));
  if (acquireResult === "completed" || acquireResult === "processing") {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    await dispatchUpdate(update);
    await markProcessedUpdateCompleted(updateId);
    return Response.json({ ok: true });
  } catch (error) {
    const message = toErrorMessage(error);
    console.error("Telegram webhook 처리 실패", {
      ...getUpdateDebugContext(update),
      error: message,
      stack: getErrorStack(error),
    });
    await notifyUnhandledUpdateError(update, message);
    await markProcessedUpdateFailed(updateId, message);
    return Response.json({ ok: false, error: "internal-error" }, { status: 500 });
  }
}
