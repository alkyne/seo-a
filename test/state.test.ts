import test from "node:test";
import assert from "node:assert/strict";
import { allowedSourceStatusesForTransition, canTransition } from "../src/state";

test("취소 can happen from 요청 or 수락", () => {
  assert.deepEqual(allowedSourceStatusesForTransition("취소"), ["요청", "수락"]);
});

test("완료 requires an approved request", () => {
  assert.equal(canTransition("수락", "완료"), true);
  assert.equal(canTransition("요청", "완료"), false);
});
