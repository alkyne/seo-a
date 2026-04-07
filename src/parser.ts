import {
  CAREGIVER_REASON_STATUSES,
  EXECUTION_STATUSES,
  type CallbackAction,
  type ParsedRequestArgs,
} from "./types";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function collapseWhitespace(text: string): string {
  return text.trim().split(/\s+/).join(" ");
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) {
    return true;
  }
  if (year % 100 === 0) {
    return false;
  }
  return year % 4 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

function throwPythonFormatError(text: string, format: string): never {
  throw new Error(`time data '${text}' does not match format '${format}'`);
}

function validatePythonDateLiteral(text: string): void {
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    throwPythonFormatError(text, "%Y-%m-%d");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year === 0) {
    throw new Error("year 0 is out of range");
  }
  if (month < 1 || month > 12 || day < 1) {
    throwPythonFormatError(text, "%Y-%m-%d");
  }
  if (day > 31) {
    throw new Error(`unconverted data remains: ${String(day).slice(-1)}`);
  }

  const daysInMonth = getDaysInMonth(year, month);
  if (day > daysInMonth) {
    throw new Error("day is out of range for month");
  }
}

function validatePythonTimeLiteral(text: string): void {
  const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    throwPythonFormatError(text, "%H:%M");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23) {
    throwPythonFormatError(text, "%H:%M");
  }
  if (minute < 0) {
    throwPythonFormatError(text, "%H:%M");
  }
  if (minute > 59) {
    throw new Error(`unconverted data remains: ${match[2].slice(-1)}`);
  }
}

function validatePythonYearLiteral(text: string): void {
  if (!/^\d+$/.test(text)) {
    throwPythonFormatError(text, "%Y");
  }
  if (text.length < 4) {
    throwPythonFormatError(text, "%Y");
  }
  if (text.length > 4) {
    throw new Error(`unconverted data remains: ${text.slice(4)}`);
  }

  const year = Number(text);
  if (!Number.isSafeInteger(year) || year === 0) {
    throw new Error("year 0 is out of range");
  }
}

export function extractCommand(text: string): string | null {
  const token = text.trim().split(/\s+/, 1)[0];
  if (!token?.startsWith("/")) {
    return null;
  }

  return token.split("@", 1)[0].toLowerCase();
}

export function splitWithMax(text: string, maxParts: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const parts: string[] = [];
  let remaining = trimmed;

  while (parts.length < maxParts - 1) {
    const match = remaining.match(/\s+/);
    if (!match || match.index === undefined) {
      break;
    }
    parts.push(remaining.slice(0, match.index));
    remaining = remaining.slice(match.index).trimStart();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

function normalizeDateAndTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): { date: string; time: string } {
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    throw new Error("invalid-datetime");
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("invalid-datetime");
  }

  const daysInMonth = getDaysInMonth(year, month);
  if (day > daysInMonth) {
    throw new Error("invalid-datetime");
  }

  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
  };
}

export function parseRequestArgs(text: string): ParsedRequestArgs {
  const parts = splitWithMax(text, 5);
  if (parts.length < 4) {
    throw new Error("형식: /request YYYY-MM-DD HH:MM 장소 요청메시지");
  }

  const requestedDate = parts[1] ?? "";
  const requestedTime = parts[2] ?? "";
  const requestedPlace = parts[3] ?? "";
  const requestMessage = parts[4] ?? "";
  validatePythonDateLiteral(requestedDate);
  validatePythonTimeLiteral(requestedTime);

  return {
    requestedDate,
    requestedTime,
    requestedPlace,
    requestMessage,
  };
}

export function parseDatetimeFlexible(text: string): { requestedDate: string; requestedTime: string } {
  const raw = collapseWhitespace(text);
  const colonMatch = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2}) (\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    try {
      const normalized = normalizeDateAndTime(
        Number(colonMatch[1]),
        Number(colonMatch[2]),
        Number(colonMatch[3]),
        Number(colonMatch[4]),
        Number(colonMatch[5]),
      );
      return {
        requestedDate: normalized.date,
        requestedTime: normalized.time,
      };
    } catch {
      // Fall through to the original generic guidance error.
    }
  }

  const koreanMatch = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2}) (\d{1,2})시(?: (\d{1,2})분)?$/);
  if (koreanMatch) {
    try {
      const normalized = normalizeDateAndTime(
        Number(koreanMatch[1]),
        Number(koreanMatch[2]),
        Number(koreanMatch[3]),
        Number(koreanMatch[4]),
        koreanMatch[5] ? Number(koreanMatch[5]) : 0,
      );
      return {
        requestedDate: normalized.date,
        requestedTime: normalized.time,
      };
    } catch {
      // Fall through to the original generic guidance error.
    }
  }

  throw new Error("일시는 예: 2026-04-20 14:00 또는 2026.04.20 14시 형식으로 입력하세요.");
}

export function parseYear(text: string): string {
  const trimmed = text.trim();
  validatePythonYearLiteral(trimmed);
  return trimmed;
}

export function parseApprovalInput(text: string): { approvedPlace: string; approvedTime: string } {
  const raw = collapseWhitespace(text);
  let approvedPlace = "";
  let approvedTime = "";

  if (raw.includes("|")) {
    const delimiterIndex = raw.indexOf("|");
    approvedPlace = raw.slice(0, delimiterIndex).trim();
    approvedTime = raw.slice(delimiterIndex + 1).trim();
  } else {
    const lastSpaceIndex = raw.lastIndexOf(" ");
    if (lastSpaceIndex === -1) {
      throw new Error("예: 경주역 2번 출구 14:00 또는 경주역 2번 출구 | 14:00");
    }
    approvedPlace = raw.slice(0, lastSpaceIndex).trim();
    approvedTime = raw.slice(lastSpaceIndex + 1).trim();
  }

  if (!approvedPlace) {
    throw new Error("장소가 비어 있습니다.");
  }

  validatePythonTimeLiteral(approvedTime);
  return { approvedPlace, approvedTime };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseCallbackData(data: string): CallbackAction {
  if (data === "requester_menu:my_requests") {
    return { kind: "requester_menu_my_requests" };
  }
  if (data === "menu:recent") {
    return { kind: "menu_recent" };
  }
  if (data === "menu:year_summary") {
    return { kind: "menu_year_summary" };
  }
  if (data === "menu:year_export") {
    return { kind: "menu_year_export" };
  }

  const requesterViewMatch = data.match(/^requester_view:(\d+)$/);
  if (requesterViewMatch) {
    return { kind: "requester_view", requestId: Number(requesterViewMatch[1]) };
  }

  const requesterReasonMatch = data.match(/^requester_reason:(\d+)$/);
  if (requesterReasonMatch) {
    return { kind: "requester_reason", requestId: Number(requesterReasonMatch[1]) };
  }

  const viewMatch = data.match(/^view:(\d+)$/);
  if (viewMatch) {
    return { kind: "view", requestId: Number(viewMatch[1]) };
  }

  const approveMatch = data.match(/^approve:(\d+)$/);
  if (approveMatch) {
    return { kind: "approve", requestId: Number(approveMatch[1]) };
  }

  const reasonMatch = data.match(/^reason_status:(\d+):(.+)$/);
  if (reasonMatch) {
    const requestId = parsePositiveInteger(reasonMatch[1] ?? "");
    const status = reasonMatch[2];
    if (requestId && CAREGIVER_REASON_STATUSES.includes(status as (typeof CAREGIVER_REASON_STATUSES)[number])) {
      return {
        kind: "reason_status",
        requestId,
        status: status as (typeof CAREGIVER_REASON_STATUSES)[number],
      };
    }
  }

  const executionMatch = data.match(/^execution:(\d+):(.+)$/);
  if (executionMatch) {
    const requestId = parsePositiveInteger(executionMatch[1] ?? "");
    const status = executionMatch[2];
    if (requestId && EXECUTION_STATUSES.includes(status as (typeof EXECUTION_STATUSES)[number])) {
      return {
        kind: "execution",
        requestId,
        status: status as (typeof EXECUTION_STATUSES)[number],
      };
    }
  }

  return { kind: "invalid", raw: data };
}

export function collapseMessageWhitespace(text: string): string {
  return collapseWhitespace(text);
}
