import test from "node:test";
import assert from "node:assert/strict";
import { isRequestStatus } from "../src/state";

test("isRequestStatus accepts every status from bot.py", () => {
  assert.equal(isRequestStatus("요청"), true);
  assert.equal(isRequestStatus("수락"), true);
  assert.equal(isRequestStatus("거절"), true);
  assert.equal(isRequestStatus("취소"), true);
  assert.equal(isRequestStatus("무응답"), true);
  assert.equal(isRequestStatus("완료"), true);
  assert.equal(isRequestStatus("미이행"), true);
});

test("isRequestStatus rejects unknown values", () => {
  assert.equal(isRequestStatus("대기"), false);
});
