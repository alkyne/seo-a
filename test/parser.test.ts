import test from "node:test";
import assert from "node:assert/strict";
import { parseApprovalInput, parseCallbackData, parseDatetimeFlexible, parseRequestArgs, parseYear } from "../src/parser";

test("parseRequestArgs preserves the one-token place behavior from bot.py", () => {
  const parsed = parseRequestArgs("/request 2026-04-20 14:00 경주역 점심 후 카페 희망");
  assert.deepEqual(parsed, {
    requestedDate: "2026-04-20",
    requestedTime: "14:00",
    requestedPlace: "경주역",
    requestMessage: "점심 후 카페 희망",
  });
});

test("parseRequestArgs accepts single-digit inline date and time fields like Python strptime", () => {
  const parsed = parseRequestArgs("/request 2026-4-2 4:0 경주역 점심 후 카페 희망");
  assert.deepEqual(parsed, {
    requestedDate: "2026-4-2",
    requestedTime: "4:0",
    requestedPlace: "경주역",
    requestMessage: "점심 후 카페 희망",
  });
});

test("parseDatetimeFlexible supports dotted Korean hour-only input", () => {
  const parsed = parseDatetimeFlexible("2026.04.20 14시");
  assert.deepEqual(parsed, {
    requestedDate: "2026-04-20",
    requestedTime: "14:00",
  });
});

test("parseDatetimeFlexible normalizes single-digit minute input", () => {
  const parsed = parseDatetimeFlexible("2026-4-2 4:0");
  assert.deepEqual(parsed, {
    requestedDate: "2026-04-02",
    requestedTime: "04:00",
  });
});

test("parseApprovalInput supports pipe separator", () => {
  const parsed = parseApprovalInput("경주역 2번 출구 | 14:00");
  assert.deepEqual(parsed, {
    approvedPlace: "경주역 2번 출구",
    approvedTime: "14:00",
  });
});

test("parseApprovalInput accepts single-digit time fields like Python", () => {
  const parsed = parseApprovalInput("경주역 2번 출구 4:0");
  assert.deepEqual(parsed, {
    approvedPlace: "경주역 2번 출구",
    approvedTime: "4:0",
  });
});

test("parseYear rejects malformed values", () => {
  assert.throws(() => parseYear("20a6"), /time data '20a6' does not match format '%Y'/);
});

test("parseYear preserves Python year-out-of-range errors", () => {
  assert.throws(() => parseYear("0000"), /year 0 is out of range/);
});

test("parseCallbackData validates caregiver reason callbacks", () => {
  const action = parseCallbackData("reason_status:42:거절");
  assert.deepEqual(action, {
    kind: "reason_status",
    requestId: 42,
    status: "거절",
  });
});

test("parseCallbackData rejects unknown callbacks", () => {
  const action = parseCallbackData("approve:not-a-number");
  assert.equal(action.kind, "invalid");
});
