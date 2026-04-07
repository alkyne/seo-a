import { neon } from "@neondatabase/serverless";
import { config } from "./config";
import { allowedSourceStatusesForTransition } from "./state";
import type {
  CaregiverReasonStatus,
  ChatId,
  ChatSessionRow,
  CreateRequestResult,
  ExecutionStatus,
  MutationResult,
  RequestStatus,
  SessionMode,
  UpdateAcquireResult,
  VisitationRequestRow,
} from "./types";

const sql = neon(config.databaseUrl);
const REPORT_TIME_ZONE = "Asia/Seoul";

const REQUEST_SELECT_COLUMNS = `
  id,
  source_update_id AS "sourceUpdateId",
  requester_chat_id AS "requesterChatId",
  requester_name AS "requesterName",
  requested_date AS "requestedDate",
  requested_time AS "requestedTime",
  requested_place AS "requestedPlace",
  request_message AS "requestMessage",
  status,
  approved_place AS "approvedPlace",
  approved_time AS "approvedTime",
  caregiver_reason AS "caregiverReason",
  requester_reason AS "requesterReason",
  execution_note AS "executionNote",
  decision_by_chat_id AS "decisionByChatId",
  CASE
    WHEN decision_at IS NULL THEN NULL
    ELSE to_char(decision_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS')
  END AS "decisionAt",
  to_char(created_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
  to_char(updated_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
`;

const SESSION_SELECT_COLUMNS = `
  chat_id AS "chatId",
  mode,
  payload,
  to_char(created_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
  to_char(updated_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
`;

function asRows<T>(rows: unknown): T[] {
  return rows as T[];
}

export async function createRequest(params: {
  sourceUpdateId: string;
  requesterChatId: ChatId;
  requesterName: string;
  requestedDate: string;
  requestedTime: string;
  requestedPlace: string;
  requestMessage: string;
}): Promise<CreateRequestResult> {
  const inserted = asRows<VisitationRequestRow>(
    await sql.query(
      `
        INSERT INTO visitation_requests (
          source_update_id,
          requester_chat_id,
          requester_name,
          requested_date,
          requested_time,
          requested_place,
          request_message,
          status,
          approved_place,
          approved_time,
          caregiver_reason,
          requester_reason,
          execution_note,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, '요청', '', '', '', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (source_update_id) DO NOTHING
        RETURNING ${REQUEST_SELECT_COLUMNS}
      `,
      [
        params.sourceUpdateId,
        params.requesterChatId,
        params.requesterName,
        params.requestedDate,
        params.requestedTime,
        params.requestedPlace,
        params.requestMessage,
      ],
    ),
  );

  if (inserted[0]) {
    return { created: true, row: inserted[0] };
  }

  const existing = await getRequestBySourceUpdateId(params.sourceUpdateId);
  if (!existing) {
    throw new Error("요청 저장에 실패했습니다.");
  }

  return { created: false, row: existing };
}

export async function getRequest(requestId: number): Promise<VisitationRequestRow | null> {
  const rows = asRows<VisitationRequestRow>(
    await sql.query(
      `SELECT ${REQUEST_SELECT_COLUMNS} FROM visitation_requests WHERE id = $1`,
      [requestId],
    ),
  );
  return rows[0] ?? null;
}

async function getRequestBySourceUpdateId(sourceUpdateId: string): Promise<VisitationRequestRow | null> {
  const rows = asRows<VisitationRequestRow>(
    await sql.query(
      `SELECT ${REQUEST_SELECT_COLUMNS} FROM visitation_requests WHERE source_update_id = $1`,
      [sourceUpdateId],
    ),
  );
  return rows[0] ?? null;
}

export async function getRecentRequests(limit = 10): Promise<VisitationRequestRow[]> {
  return asRows<VisitationRequestRow>(
    await sql.query(
      `SELECT ${REQUEST_SELECT_COLUMNS} FROM visitation_requests ORDER BY id DESC LIMIT $1`,
      [limit],
    ),
  );
}

export async function getYearRequests(year: string): Promise<VisitationRequestRow[]> {
  return asRows<VisitationRequestRow>(
    await sql.query(
      `
        SELECT ${REQUEST_SELECT_COLUMNS}
        FROM visitation_requests
        WHERE substring(requested_date, 1, 4) = $1
        ORDER BY requested_date ASC, id ASC
      `,
      [year],
    ),
  );
}

export async function getRequestsForRequester(chatId: ChatId, limit = 10): Promise<VisitationRequestRow[]> {
  return asRows<VisitationRequestRow>(
    await sql.query(
      `
        SELECT ${REQUEST_SELECT_COLUMNS}
        FROM visitation_requests
        WHERE requester_chat_id = $1
        ORDER BY id DESC
        LIMIT $2
      `,
      [chatId, limit],
    ),
  );
}

export async function saveRequesterReason(
  requestId: number,
  requesterChatId: ChatId,
  reason: string,
): Promise<MutationResult> {
  const updated = asRows<VisitationRequestRow>(
    await sql.query(
      `
        UPDATE visitation_requests
        SET requester_reason = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND requester_chat_id = $3
        RETURNING ${REQUEST_SELECT_COLUMNS}
      `,
      [reason, requestId, requesterChatId],
    ),
  );

  if (updated[0]) {
    return { kind: "updated", row: updated[0] };
  }

  const existing = await getRequest(requestId);
  if (!existing) {
    return { kind: "not_found", row: null };
  }
  if (existing.requesterChatId !== requesterChatId) {
    return { kind: "forbidden", row: existing };
  }
  return { kind: "updated", row: existing };
}

export async function transitionApprove(
  requestId: number,
  actorChatId: ChatId,
  approvedPlace: string,
  approvedTime: string,
): Promise<MutationResult> {
  const updated = asRows<VisitationRequestRow>(
    await sql.query(
      `
        UPDATE visitation_requests
        SET
          status = '수락',
          approved_place = $1,
          approved_time = $2,
          decision_by_chat_id = $3,
          decision_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND status = '요청'
        RETURNING ${REQUEST_SELECT_COLUMNS}
      `,
      [approvedPlace, approvedTime, actorChatId, requestId],
    ),
  );

  if (updated[0]) {
    return { kind: "updated", row: updated[0] };
  }

  const existing = await getRequest(requestId);
  if (!existing) {
    return { kind: "not_found", row: null };
  }
  if (existing.status === "수락" && existing.approvedPlace === approvedPlace && existing.approvedTime === approvedTime) {
    return { kind: "already_applied", row: existing };
  }
  return { kind: "invalid_state", row: existing };
}

export async function transitionCaregiverReason(
  requestId: number,
  actorChatId: ChatId,
  status: CaregiverReasonStatus,
  reason: string,
): Promise<MutationResult> {
  const allowedStatuses = allowedSourceStatusesForTransition(status);
  const updated = asRows<VisitationRequestRow>(
    await sql.query(
      `
        UPDATE visitation_requests
        SET
          status = $1,
          caregiver_reason = $2,
          decision_by_chat_id = $3,
          decision_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND status = ANY($5::text[])
        RETURNING ${REQUEST_SELECT_COLUMNS}
      `,
      [status, reason, actorChatId, requestId, allowedStatuses],
    ),
  );

  if (updated[0]) {
    return { kind: "updated", row: updated[0] };
  }

  const existing = await getRequest(requestId);
  if (!existing) {
    return { kind: "not_found", row: null };
  }
  if (existing.status === status && existing.caregiverReason === reason) {
    return { kind: "already_applied", row: existing };
  }
  return { kind: "invalid_state", row: existing };
}

export async function transitionExecutionStatus(
  requestId: number,
  actorChatId: ChatId,
  status: ExecutionStatus,
  executionNote: string,
): Promise<MutationResult> {
  const allowedStatuses = allowedSourceStatusesForTransition(status);
  const updated = asRows<VisitationRequestRow>(
    await sql.query(
      `
        UPDATE visitation_requests
        SET
          status = $1,
          execution_note = $2,
          decision_by_chat_id = $3,
          decision_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND status = ANY($5::text[])
        RETURNING ${REQUEST_SELECT_COLUMNS}
      `,
      [status, executionNote, actorChatId, requestId, allowedStatuses],
    ),
  );

  if (updated[0]) {
    return { kind: "updated", row: updated[0] };
  }

  const existing = await getRequest(requestId);
  if (!existing) {
    return { kind: "not_found", row: null };
  }
  if (existing.status === status && existing.executionNote === executionNote) {
    return { kind: "already_applied", row: existing };
  }
  return { kind: "invalid_state", row: existing };
}

export async function getChatSession(chatId: ChatId): Promise<ChatSessionRow | null> {
  const rows = asRows<ChatSessionRow>(
    await sql.query(
      `SELECT ${SESSION_SELECT_COLUMNS} FROM chat_sessions WHERE chat_id = $1`,
      [chatId],
    ),
  );
  return rows[0] ?? null;
}

export async function saveChatSession(
  chatId: ChatId,
  mode: SessionMode,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await sql.query(
    `
      INSERT INTO chat_sessions (chat_id, mode, payload, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (chat_id)
      DO UPDATE SET mode = EXCLUDED.mode, payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP
    `,
    [chatId, mode, JSON.stringify(payload)],
  );
}

export async function clearChatSession(chatId: ChatId): Promise<void> {
  await sql.query(`DELETE FROM chat_sessions WHERE chat_id = $1`, [chatId]);
}

export async function beginProcessedUpdate(
  updateId: string,
  kind: string,
  chatId?: ChatId,
): Promise<UpdateAcquireResult> {
  const inserted = asRows<{ updateId: string }>(
    await sql.query(
      `
        INSERT INTO processed_updates (update_id, kind, chat_id, state, last_error, created_at, updated_at)
        VALUES ($1, $2, $3, 'processing', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (update_id) DO NOTHING
        RETURNING update_id AS "updateId"
      `,
      [updateId, kind, chatId ?? null],
    ),
  );

  if (inserted[0]) {
    return "acquired";
  }

  const existing = asRows<{ state: string }>(
    await sql.query(`SELECT state FROM processed_updates WHERE update_id = $1`, [updateId]),
  )[0];

  if (!existing) {
    return "acquired";
  }

  if (existing.state === "failed") {
    const retried = asRows<{ updateId: string }>(
      await sql.query(
        `
          UPDATE processed_updates
          SET state = 'processing', last_error = '', updated_at = CURRENT_TIMESTAMP
          WHERE update_id = $1 AND state = 'failed'
          RETURNING update_id AS "updateId"
        `,
        [updateId],
      ),
    );
    if (retried[0]) {
      return "retried";
    }
  }

  return existing.state === "completed" ? "completed" : "processing";
}

export async function markProcessedUpdateCompleted(updateId: string): Promise<void> {
  await sql.query(
    `
      UPDATE processed_updates
      SET state = 'completed', last_error = '', updated_at = CURRENT_TIMESTAMP
      WHERE update_id = $1
    `,
    [updateId],
  );
}

export async function markProcessedUpdateFailed(updateId: string, errorMessage: string): Promise<void> {
  await sql.query(
    `
      UPDATE processed_updates
      SET state = 'failed', last_error = $2, updated_at = CURRENT_TIMESTAMP
      WHERE update_id = $1
    `,
    [updateId, errorMessage.slice(0, 2000)],
  );
}
