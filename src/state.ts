import type { RequestStatus } from "./types";

export function allowedSourceStatusesForTransition(target: RequestStatus): RequestStatus[] {
  switch (target) {
    case "수락":
    case "거절":
    case "무응답":
      return ["요청"];
    case "취소":
      return ["요청", "수락"];
    case "완료":
    case "미이행":
      return ["수락"];
    case "요청":
      return [];
  }
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return allowedSourceStatusesForTransition(to).includes(from);
}
