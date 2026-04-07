# Migration Notes

## Exact parity preserved

- Role split by `ADMIN_CHAT_ID`, including different `/start` and `/help` messages.
- Requester commands: `/start`, `/help`, `/request`, `/my_requests`, `/reason`.
- Caregiver commands: `/start`, `/help`, `/menu`, `/list`, `/yearly YYYY`, `/export_yearly YYYY`.
- Inline callbacks preserved: `menu:recent`, `menu:year_summary`, `menu:year_export`, `view:{id}`, `approve:{id}`, `reason_status:{id}:{status}`, `execution:{id}:{status}`, `requester_reason:{id}`, `requester_view:{id}`, `requester_menu:my_requests`.
- Guided requester flow preserved: date/time -> place -> message with exact `"없음"` to empty-string behavior.
- Inline `/request` parsing asymmetry preserved: command format still supports only a single-token place unless the user uses the guided flow.
- Request detail formatting preserved, including the same labels and `-` placeholders for empty fields.
- Requester and caregiver home keyboards preserved with the same button labels.
- Requester `/my_requests` and caregiver `/list` both return the latest 10 records with inline action buttons.
- Year summary ordering, CSV ordering, and CSV header labels preserved.

## Improved for production

- Polling replaced with Telegram webhook handling in [api/telegram.ts](/Users/rocketman/Documents/seo-a/api/telegram.ts).
- SQLite, CSV files, and in-memory `PENDING_INPUTS` replaced with Neon-backed `visitation_requests`, `chat_sessions`, and `processed_updates`.
- All SQL calls are parameterized via the Neon serverless driver.
- Callback payloads are parsed and validated before use.
- Duplicate webhook deliveries are deduplicated via `processed_updates`.
- Caregiver/admin status updates now match the original Python bot's overwrite behavior instead of enforcing a stricter transition graph.
- Year summary rendering now matches the original Python bot's legacy Markdown output and unescaped text layout.

## Non-exact migrations

- Python referenced undefined `get_conn()` and `DATA_DIR`; the new version replaces those missing pieces with explicit Neon persistence and in-memory CSV uploads.
- Callback misuse is no longer silently ignored in key cases. Invalid or unauthorized callback usage is acknowledged safely instead of falling through with no feedback.
- The GET handler on [api/telegram.ts](/Users/rocketman/Documents/seo-a/api/telegram.ts) returns a simple health payload including the computed webhook URL. This is additive and does not affect bot behavior.
