CREATE TABLE IF NOT EXISTS visitation_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_update_id text NOT NULL UNIQUE,
  requester_chat_id text NOT NULL,
  requester_name text NOT NULL,
  requested_date text NOT NULL CHECK (requested_date ~ '^\d{4}-\d{1,2}-\d{1,2}$'),
  requested_time text NOT NULL CHECK (requested_time ~ '^\d{1,2}:\d{1,2}$'),
  requested_place text NOT NULL,
  request_message text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('요청', '수락', '거절', '취소', '무응답', '완료', '미이행')),
  approved_place text NOT NULL DEFAULT '',
  approved_time text NOT NULL DEFAULT '' CHECK (approved_time = '' OR approved_time ~ '^\d{1,2}:\d{1,2}$'),
  caregiver_reason text NOT NULL DEFAULT '',
  requester_reason text NOT NULL DEFAULT '',
  execution_note text NOT NULL DEFAULT '',
  decision_by_chat_id text,
  decision_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visitation_requests_requester_chat_id
  ON visitation_requests (requester_chat_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_visitation_requests_requested_date
  ON visitation_requests (requested_date, id ASC);

CREATE INDEX IF NOT EXISTS idx_visitation_requests_status
  ON visitation_requests (status);

CREATE TABLE IF NOT EXISTS chat_sessions (
  chat_id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN (
    'request_date_time',
    'request_place',
    'request_message',
    'approve',
    'caregiver_reason',
    'execution_note',
    'requester_reason',
    'year_summary',
    'year_export'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id text PRIMARY KEY,
  kind text NOT NULL,
  chat_id text,
  state text NOT NULL CHECK (state IN ('processing', 'completed', 'failed')),
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
