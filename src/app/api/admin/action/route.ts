import { z } from "zod";
import { isAdminApiAllowed } from "@/lib/admin-auth";
import {
  advanceGame,
  forceResolve,
  getSnapshot,
  resetGame,
  setDelivery,
  startGame,
} from "@/lib/game-data";
import { sendCurrentStage } from "@/lib/game-bot";
import { hasSupabaseConfig } from "@/lib/supabase-server";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    durationSeconds: z.number().int().min(60).max(86_400).optional(),
  }),
  z.object({
    type: z.literal("advance"),
    durationSeconds: z.number().int().min(60).max(86_400).optional(),
  }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("force"), teamId: z.string(), choiceId: z.string() }),
  z.object({ type: z.literal("resend"), teamId: z.string().optional() }),
]);

export async function POST(request: Request) {
  if (!isAdminApiAllowed(request)) {
    return Response.json({ error: "Требуется admin token" }, { status: 401 });
  }

  if (!hasSupabaseConfig()) {
    return Response.json(
      { error: "Supabase env не задан. Admin actions доступны после подключения БД." },
      { status: 400 },
    );
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Некорректная команда" }, { status: 400 });
  }

  try {
    const action = parsed.data;

    switch (action.type) {
      case "start":
        await startGame(action.durationSeconds);
        await deliver();
        break;
      case "advance":
        await advanceGame(action.durationSeconds);
        if ((await getSnapshot()).game.status === "running") {
          await deliver();
        }
        break;
      case "reset":
        await resetGame();
        break;
      case "force":
        await forceResolve(action.teamId, action.choiceId);
        break;
      case "resend":
        await deliver(action.teamId);
        break;
    }

    return Response.json(await getSnapshot());
  } catch (error) {
    const known = error as Error & { blockers?: string[] };
    return Response.json(
      { error: known.message, blockers: known.blockers },
      { status: known.blockers ? 409 : 400 },
    );
  }
}

async function deliver(teamId?: string) {
  const snapshot = await getSnapshot();
  const teams = teamId
    ? snapshot.teams.filter((team) => team.id === teamId)
    : snapshot.teams;

  await Promise.all(
    teams.map(async (team) => {
      if (!team.captainChatId || team.currentStageIndex < 0) {
        return;
      }

      try {
        await sendCurrentStage(team);
      } catch (error) {
        await setDelivery(
          team.id,
          "failed",
          error instanceof Error ? error.message : "Ошибка доставки",
        );
      }
    }),
  );
}
