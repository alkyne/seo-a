import { config } from "../src/config";
import { handleTelegramWebhook } from "../src/handlers";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    webhookUrl: config.webhookUrl,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request);
}
