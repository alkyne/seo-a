import { REQUEST_STATUSES, type RequestStatus } from "./types";

export function isRequestStatus(value: string): value is RequestStatus {
  return REQUEST_STATUSES.includes(value as RequestStatus);
}
