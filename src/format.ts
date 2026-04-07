import { REQUEST_STATUSES, type CsvDocument, type InlineKeyboardMarkup, type ReplyKeyboardMarkup, type ReplyKeyboardRemove, type VisitationRequestRow, type YearSummaryMessage } from "./types";

function csvCell(value: string | number): string {
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export function formatRequest(row: VisitationRequestRow): string {
  return (
    `[요청 ID ${row.id}] 상태: ${row.status}\n` +
    `비양육자: ${row.requesterName}\n` +
    `요청일시: ${row.requestedDate} ${row.requestedTime}\n` +
    `요청장소: ${row.requestedPlace}\n` +
    `요청메시지: ${row.requestMessage || "-"}\n` +
    `확정장소: ${row.approvedPlace || "-"}\n` +
    `확정시간: ${row.approvedTime || "-"}\n` +
    `양육자 사유: ${row.caregiverReason || "-"}\n` +
    `비양육자 사유: ${row.requesterReason || "-"}\n` +
    `실행메모: ${row.executionNote || "-"}`
  );
}

export function buildRequesterHomeKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "요청하기" }],
      [{ text: "내 요청 보기" }],
      [{ text: "사유 남기기" }],
    ],
    resize_keyboard: true,
  };
}

export function buildCaregiverHomeKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "양육자 메뉴" }],
      [{ text: "최근 요청 보기" }],
      [{ text: "연별 요약" }],
      [{ text: "연별 CSV" }],
    ],
    resize_keyboard: true,
  };
}

export function buildKeyboardRemove(): ReplyKeyboardRemove {
  return { remove_keyboard: true };
}

export function buildCaregiverMenu(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "📋 최근 요청 보기", callback_data: "menu:recent" }],
      [{ text: "🗓️ 연별 요약", callback_data: "menu:year_summary" }],
      [{ text: "⬇️ 연별 CSV", callback_data: "menu:year_export" }],
    ],
  };
}

export function buildCaregiverActions(requestId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "수락", callback_data: `approve:${requestId}` },
        { text: "거절", callback_data: `reason_status:${requestId}:거절` },
      ],
      [
        { text: "완료", callback_data: `execution:${requestId}:완료` },
        { text: "미이행", callback_data: `execution:${requestId}:미이행` },
      ],
      [
        { text: "취소", callback_data: `reason_status:${requestId}:취소` },
        { text: "무응답", callback_data: `reason_status:${requestId}:무응답` },
      ],
      [{ text: "새로고침", callback_data: `view:${requestId}` }],
    ],
  };
}

export function buildRequesterActions(requestId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "비양육자 사유 남기기", callback_data: `requester_reason:${requestId}` }],
      [{ text: "내 요청 다시보기", callback_data: `requester_view:${requestId}` }],
    ],
  };
}

export function buildRequesterStartText(): string {
  return (
    "면접교섭 요청 봇입니다.\n\n" +
    "비양육자 사용 가능 명령\n" +
    "/start\n" +
    "/help\n" +
    "/request\n" +
    "/my_requests\n" +
    "/reason 요청ID 사유\n\n" +
    "이제 /request 만 입력하면 순서대로 물어봅니다."
  );
}

export function buildCaregiverStartText(): string {
  return (
    "양육자 모드입니다.\n\n" +
    "비양육자가 /request 로 요청하면 여기로 전달됩니다.\n" +
    "수락은 장소와 시간을 글로 입력하면 됩니다.\n" +
    "거절·취소·무응답·미이행은 사유를 함께 기록합니다.\n" +
    "완료/미이행에는 실행 메모도 남길 수 있습니다.\n\n" +
    "양육자 명령어\n" +
    "/menu\n" +
    "/list\n" +
    "/yearly YYYY\n" +
    "/export_yearly YYYY\n" +
    "/help"
  );
}

export function buildYearSummaryMessage(year: string, rows: VisitationRequestRow[]): YearSummaryMessage {
  if (rows.length === 0) {
    return { text: "해당 연도 기록이 없습니다." };
  }

  const counts = Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<(typeof REQUEST_STATUSES)[number], number>;
  for (const row of rows) {
    counts[row.status] += 1;
  }

  const lines = [
    `*${year} 면접교섭 연별 리포트*`,
    `- 총 요청: ${rows.length}`,
    `- 요청: ${counts["요청"]}`,
    `- 수락: ${counts["수락"]}`,
    `- 거절: ${counts["거절"]}`,
    `- 취소: ${counts["취소"]}`,
    `- 무응답: ${counts["무응답"]}`,
    `- 완료: ${counts["완료"]}`,
    `- 미이행: ${counts["미이행"]}`,
    "",
    "*상세 이력*",
  ];

  for (const row of rows) {
    lines.push(`- ID ${row.id} | ${row.requestedDate} ${row.requestedTime} | ${row.status}`);
    lines.push(`  비양육자: ${row.requesterName}`);
    lines.push(`  요청장소: ${row.requestedPlace}`);
    lines.push(`  요청메시지: ${row.requestMessage || "-"}`);
    lines.push(`  확정장소/시간: ${(row.approvedPlace || "-")} / ${(row.approvedTime || "-")}`);
    lines.push(`  양육자 사유: ${row.caregiverReason || "-"}`);
    lines.push(`  비양육자 사유: ${row.requesterReason || "-"}`);
    lines.push(`  실행메모: ${row.executionNote || "-"}`);
  }

  return {
    text: lines.join("\n"),
    parseMode: "Markdown",
  };
}

export function buildYearCsv(year: string, rows: VisitationRequestRow[]): CsvDocument {
  const headers = [
    "ID",
    "비양육자",
    "요청일",
    "요청시간",
    "요청장소",
    "요청메시지",
    "상태",
    "확정장소",
    "확정시간",
    "양육자사유",
    "비양육자사유",
    "실행메모",
    "생성시각",
    "수정시각",
  ];

  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.requesterName,
        row.requestedDate,
        row.requestedTime,
        row.requestedPlace,
        row.requestMessage,
        row.status,
        row.approvedPlace,
        row.approvedTime,
        row.caregiverReason,
        row.requesterReason,
        row.executionNote,
        row.createdAt,
        row.updatedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const text = `\uFEFF${lines.join("\r\n")}`;
  return {
    fileName: `visitation_requests_${year}.csv`,
    content: new TextEncoder().encode(text),
  };
}
