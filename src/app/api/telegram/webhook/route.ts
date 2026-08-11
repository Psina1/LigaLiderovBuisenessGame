import { handleTelegramUpdate } from "@/lib/game-bot";
import type { TelegramUpdate } from "@/lib/telegram";

export async function GET() {
  return Response.json({
    ok: true,
    service: "liga-liderov-telegram-webhook",
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
}

export async function POST(request: Request) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    if (
      expectedSecret &&
      request.headers.get("x-telegram-bot-api-secret-token") !== expectedSecret
    ) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    const result = await handleTelegramUpdate(update);

    return Response.json(result);
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false }, { status: 200 });
  }
}
