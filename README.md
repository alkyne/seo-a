# Telegram Approval Bot Migration

This repository contains a production-oriented migration of the original Python polling bot in [bot.py](/Users/rocketman/Documents/seo-a/bot.py) to a Vercel-friendly Node.js + TypeScript webhook bot backed by Neon Postgres.

## What It Preserves

- Role split by `ADMIN_CHAT_ID`
- Requester commands: `/start`, `/help`, `/request`, `/my_requests`, `/reason`
- Caregiver commands: `/start`, `/help`, `/menu`, `/list`, `/yearly YYYY`, `/export_yearly YYYY`
- Guided requester flow and inline `/request` flow
- Inline admin actions for approve / reject / cancel / no-response / complete / failed-execution
- Requester and caregiver notifications
- Year summary and yearly CSV export
- Button labels and message copy from `bot.py`

## Project Layout

```text
api/
  telegram.ts
src/
  auth.ts
  config.ts
  db.ts
  format.ts
  handlers.ts
  migration-notes.md
  parser.ts
  state.ts
  telegram.ts
  types.ts
test/
  format.test.ts
  parser.test.ts
  state.test.ts
.env.example
.gitignore
README.md
bot.py
package.json
schema.sql
tsconfig.json
```

## Environment Variables

Create a `.env` file or configure the same variables in Vercel:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token from BotFather
- `ADMIN_CHAT_ID`: caregiver/admin Telegram chat ID
- `APP_BASE_URL`: deployed base URL such as `https://your-app.vercel.app`
- `DATABASE_URL`: Neon pooled connection string

An example file is provided in [.env.example](/Users/rocketman/Documents/seo-a/.env.example).

## Database Setup

Apply the schema in [schema.sql](/Users/rocketman/Documents/seo-a/schema.sql) to your Neon database:

```bash
psql "$DATABASE_URL" -f schema.sql
```

If you prefer the Neon SQL editor, paste the full contents of `schema.sql` there and run it once.

## Local Development

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy the environment file and fill in real values:

```bash
cp .env.example .env
```

4. Apply the schema to Neon.
5. Start the Vercel local dev server:

```bash
npm run dev
```

6. In another terminal, expose your local webhook with a tunnel such as `ngrok` or `cloudflared`.
7. Register the tunnel URL as the Telegram webhook.

## Checks and Tests

TypeScript check:

```bash
npm run check
```

Pure-logic tests:

```bash
npm test
```

The tests cover parser behavior, the request formatter, the yearly summary/CSV renderer, and the intended transition rules.

## Vercel Deployment

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import the repo into Vercel.
3. Add the environment variables listed above in the Vercel project settings.
4. Apply the schema to the production Neon database.
5. Deploy.

The webhook function lives at:

```text
https://<your-domain>/api/telegram
```

The GET handler on the same path returns a small health payload including the computed webhook URL.

## Telegram Webhook Registration

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${APP_BASE_URL}/api/telegram\"}"
```

To inspect the current webhook:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## Behavior Notes

- `bot.py` is kept as the source reference for the original implementation.
- Request flow state is stored in Postgres via `chat_sessions`, not in memory.
- Duplicate updates are tracked in `processed_updates`.
- Request rows are keyed by the Telegram message update that created them to prevent duplicate inserts.
- State transitions are intentionally stricter than the Python version to make admin actions race-safe and production-safe.

Detailed parity notes are documented in [src/migration-notes.md](/Users/rocketman/Documents/seo-a/src/migration-notes.md).
