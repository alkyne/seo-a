import test from "node:test";
import assert from "node:assert/strict";
import { buildYearCsv, buildYearSummaryMessage, formatRequest } from "../src/format";
import type { VisitationRequestRow } from "../src/types";

const sampleRow: VisitationRequestRow = {
  id: 7,
  sourceUpdateId: "1007",
  requesterChatId: "11",
  requesterName: "홍 길동",
  requestedDate: "2026-04-20",
  requestedTime: "14:00",
  requestedPlace: "경주역 2번 출구",
  requestMessage: "점심 후 카페 희망",
  status: "요청",
  approvedPlace: "",
  approvedTime: "",
  caregiverReason: "",
  requesterReason: "",
  executionNote: "",
  decisionByChatId: null,
  decisionAt: null,
  createdAt: "2026-04-07 22:00:00",
  updatedAt: "2026-04-07 22:00:00",
};

test("formatRequest preserves the Python text layout", () => {
  const text = formatRequest(sampleRow);
  assert.equal(
    text,
    "[요청 ID 7] 상태: 요청\n" +
      "비양육자: 홍 길동\n" +
      "요청일시: 2026-04-20 14:00\n" +
      "요청장소: 경주역 2번 출구\n" +
      "요청메시지: 점심 후 카페 희망\n" +
      "확정장소: -\n" +
      "확정시간: -\n" +
      "양육자 사유: -\n" +
      "비양육자 사유: -\n" +
      "실행메모: -",
  );
});

test("buildYearSummaryMessage preserves the Python Markdown text layout", () => {
  const message = buildYearSummaryMessage("2026", [
    {
      ...sampleRow,
      requesterName: "홍_길동",
    },
  ]);

  assert.equal(message.parseMode, "Markdown");
  assert.equal(
    message.text,
    "*2026 면접교섭 연별 리포트*\n" +
      "- 총 요청: 1\n" +
      "- 요청: 1\n" +
      "- 수락: 0\n" +
      "- 거절: 0\n" +
      "- 취소: 0\n" +
      "- 무응답: 0\n" +
      "- 완료: 0\n" +
      "- 미이행: 0\n\n" +
      "*상세 이력*\n" +
      "- ID 7 | 2026-04-20 14:00 | 요청\n" +
      "  비양육자: 홍_길동\n" +
      "  요청장소: 경주역 2번 출구\n" +
      "  요청메시지: 점심 후 카페 희망\n" +
      "  확정장소/시간: - / -\n" +
      "  양육자 사유: -\n" +
      "  비양육자 사유: -\n" +
      "  실행메모: -",
  );
});

test("buildYearCsv emits the original CSV headers and BOM", () => {
  const csv = buildYearCsv("2026", [sampleRow]);
  const text = new TextDecoder().decode(csv.content);

  assert.equal(csv.fileName, "visitation_requests_2026.csv");
  assert.ok(text.startsWith("\uFEFFID,비양육자,요청일,요청시간"));
  assert.match(text, /홍 길동/);
});
