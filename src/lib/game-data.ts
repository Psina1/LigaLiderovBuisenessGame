import { createMockSnapshot } from "./mock-data";
import { getSupabaseServiceClient, hasSupabaseConfig } from "./supabase-server";
import {
  applyBlueQ2Answer,
  getBlueQ2ChoiceId,
  getBlueQ2ChoiceLabel,
  getChoiceLabel,
  getScenarioStage,
  isCompleteBlueQ2Draft,
  scenarioLength,
} from "./scenario";
import type {
  AuditEvent,
  DecisionRecord,
  DecisionSource,
  FileArchiveItem,
  DeliveryState,
  GameSnapshot,
  GameState,
  TeamColor,
  TeamState,
} from "./game-types";

type CaptainInput = {
  telegramId: number;
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
};

type TelegramFileInput = {
  telegramFileId: string;
  telegramFileUniqueId: string | null;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type SessionRow = {
  id: string;
  status: string;
  current_stage_index: number;
  duration_seconds: number;
  stage_opened_at: string | null;
  deadline_at: string | null;
  created_at: string;
  completed_at: string | null;
};

type TeamRow = {
  id: string;
  team_number: number;
  name: string;
  color: TeamColor;
  captain_telegram_id: number | string | null;
  captain_chat_id: number | string | null;
  captain_name: string | null;
};

type ProgressRow = {
  team_id: string;
  stage_index: number;
  status: string;
  selected_choice_id: string | null;
  selected_choice_label: string | null;
  selected_source: DecisionSource | null;
  decision_confirmed_at: string | null;
  file_name: string | null;
  file_url: string | null;
  last_activity_at: string | null;
  q2_hire: boolean | null;
  q2_pr: boolean | null;
  q2_bonus: boolean | null;
};

type DecisionRow = {
  team_id: string;
  stage_index: number;
  stage_id: string;
  choice_id: string;
  choice_label: string;
  source: DecisionSource;
  confirmed_at: string;
  file_missing_on_forced_advance: boolean | null;
};

type DeliveryRow = {
  team_id: string;
  status: "sent" | "failed";
  error_code: string | null;
  attempted_at: string;
};

type AuditRow = {
  id: string;
  team_id: string | null;
  actor_type: "captain" | "organizer" | "system";
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type FileArchiveRow = {
  id: string;
  session_id: string;
  team_id: string;
  stage_index: number;
  file_name: string;
  received_at: string;
};

type ArchiveSessionRow = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

type CaptainEventRow = {
  session_id: string;
  team_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export async function getDashboardData(): Promise<GameSnapshot> {
  if (!hasSupabaseConfig()) {
    return createMockSnapshot();
  }

  return getSnapshot();
}

export async function getSnapshot(): Promise<GameSnapshot> {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();

  const [
    teamsResult,
    progressResult,
    decisionsResult,
    filesResult,
    deliveryResult,
    auditResult,
  ] = await Promise.all([
    supabase.from("teams").select("*").order("team_number"),
    supabase
      .from("team_stage_progress")
      .select("*")
      .eq("session_id", session.id),
    supabase
      .from("decisions")
      .select("*")
      .eq("session_id", session.id)
      .order("stage_index"),
    supabase
      .from("uploaded_files")
      .select("*")
      .eq("session_id", session.id)
      .order("received_at", { ascending: false }),
    supabase
      .from("delivery_attempts")
      .select("*")
      .eq("session_id", session.id)
      .order("attempted_at", { ascending: false }),
    supabase
      .from("bot_events")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const firstError =
    teamsResult.error ??
    progressResult.error ??
    decisionsResult.error ??
    filesResult.error ??
    deliveryResult.error ??
    auditResult.error;

  if (firstError) {
    throw firstError;
  }

  const decisionsByTeam = groupBy(
    ((decisionsResult.data ?? []) as DecisionRow[]).map(mapDecision),
    (decision) => decision.teamId,
  );
  const progressByTeam = new Map(
    ((progressResult.data ?? []) as ProgressRow[])
      .filter((progress) => progress.stage_index === session.current_stage_index)
      .map((progress) => [progress.team_id, progress]),
  );
  const latestDeliveryByTeam = new Map<string, DeliveryState>();

  for (const delivery of (deliveryResult.data ?? []) as DeliveryRow[]) {
    if (!latestDeliveryByTeam.has(delivery.team_id)) {
      latestDeliveryByTeam.set(delivery.team_id, {
        status: delivery.status,
        at: delivery.attempted_at,
        error: delivery.error_code ?? undefined,
      });
    }
  }

  const latestFileByTeam = new Map<string, { id: string; name: string; url: string }>();

  for (const file of (filesResult.data ?? []) as Array<{
    id: string;
    team_id: string;
    file_name: string;
    storage_path: string | null;
    telegram_file_id: string;
  }>) {
    if (!latestFileByTeam.has(file.team_id)) {
      latestFileByTeam.set(file.team_id, {
        id: file.id,
        name: file.file_name,
        url: file.storage_path ?? `telegram-file:${file.telegram_file_id}`,
      });
    }
  }

  const teams = ((teamsResult.data ?? []) as TeamRow[]).map((teamRow) => {
    const progress = progressByTeam.get(teamRow.id);
    const latestFile = latestFileByTeam.get(teamRow.id);

    return mapTeamState(
      teamRow,
      session,
      progress,
      decisionsByTeam.get(teamRow.id) ?? [],
      latestDeliveryByTeam.get(teamRow.id),
      latestFile,
    );
  });

  return {
    game: mapGameState(session),
    teams,
    audit: ((auditResult.data ?? []) as AuditRow[]).map(mapAudit),
    serverNow: new Date().toISOString(),
    source: "supabase",
  };
}

export async function getActiveTeams() {
  return (await getSnapshot()).teams;
}

export async function getFileArchive(): Promise<FileArchiveItem[]> {
  if (!hasSupabaseConfig()) {
    return [];
  }

  const supabase = getSupabaseServiceClient();
  const { data: fileRows, error: filesError } = await supabase
    .from("uploaded_files")
    .select("id,session_id,team_id,stage_index,file_name,received_at")
    .order("received_at", { ascending: false })
    .limit(300);

  if (filesError) {
    throw filesError;
  }

  const files = (fileRows ?? []) as FileArchiveRow[];

  if (!files.length) {
    return [];
  }

  const sessionIds = [...new Set(files.map((file) => file.session_id))];
  const [sessionsResult, teamsResult, captainEventsResult] = await Promise.all([
    supabase
      .from("game_sessions")
      .select("id,status,created_at,completed_at")
      .in("id", sessionIds),
    supabase
      .from("teams")
      .select("id,team_number,name,color,captain_telegram_id,captain_name"),
    supabase
      .from("bot_events")
      .select("session_id,team_id,payload,created_at")
      .in("session_id", sessionIds)
      .in("event_type", ["captain.bound", "captain.auto_bound", "captain.snapshot"])
      .order("created_at", { ascending: true }),
  ]);

  const firstError =
    sessionsResult.error ?? teamsResult.error ?? captainEventsResult.error;

  if (firstError) {
    throw firstError;
  }

  const sessionsById = new Map(
    ((sessionsResult.data ?? []) as ArchiveSessionRow[]).map((session) => [
      session.id,
      session,
    ]),
  );
  const teamsById = new Map(
    ((teamsResult.data ?? []) as TeamRow[]).map((team) => [team.id, team]),
  );
  const captainsBySessionTeam = new Map<
    string,
    { captainName?: string; captainTelegramId?: string }
  >();

  for (const event of (captainEventsResult.data ?? []) as CaptainEventRow[]) {
    if (!event.team_id) {
      continue;
    }

    captainsBySessionTeam.set(`${event.session_id}:${event.team_id}`, {
      captainName: readStringPayload(event.payload, "captainName"),
      captainTelegramId: readStringPayload(event.payload, "telegramId"),
    });
  }

  return files.map((file) => {
    const session = sessionsById.get(file.session_id);
    const team = teamsById.get(file.team_id);
    const captainSnapshot = captainsBySessionTeam.get(`${file.session_id}:${file.team_id}`);

    return {
      id: file.id,
      sessionId: file.session_id,
      sessionStatus: (session?.status ?? "completed") as FileArchiveItem["sessionStatus"],
      sessionStartedAt: session?.created_at ?? file.received_at,
      sessionCompletedAt: session?.completed_at ?? undefined,
      teamId: file.team_id,
      teamName: team?.name ?? file.team_id,
      teamNumber: Number(team?.team_number ?? file.team_id.replace(/\D/g, "")) || 0,
      teamColor: team?.color ?? "red",
      captainName:
        captainSnapshot?.captainName ??
        (team?.captain_name ?? undefined),
      captainTelegramId:
        captainSnapshot?.captainTelegramId ??
        (team?.captain_telegram_id ? String(team.captain_telegram_id) : undefined),
      stageIndex: file.stage_index,
      fileName: file.file_name,
      receivedAt: file.received_at,
    };
  });
}

export async function getTeam(teamId: string) {
  const team = (await getSnapshot()).teams.find((item) => item.id === teamId);

  if (!team) {
    throw new Error("Команда не найдена");
  }

  return team;
}

export async function getTeamByCaptainTelegramId(telegramId: number) {
  return (
    (await getSnapshot()).teams.find(
      (team) => team.captainTelegramId === String(telegramId),
    ) ?? null
  );
}

export async function bindCaptain(teamId: string, captain: CaptainInput) {
  const supabase = getSupabaseServiceClient();
  const snapshot = await getSnapshot();
  const team = snapshot.teams.find((item) => item.id === teamId);
  const captainName = formatCaptainName(captain);

  if (!team) {
    return { status: "missing" as const, team: null };
  }

  if (team.captainTelegramId && team.captainTelegramId !== String(captain.telegramId)) {
    return { status: "already_taken" as const, team };
  }

  const captainConflict = snapshot.teams.find(
    (item) =>
      item.id !== teamId &&
      (item.captainTelegramId === String(captain.telegramId) ||
        item.captainChatId === String(captain.chatId)),
  );

  if (captainConflict) {
    return { status: "captain_conflict" as const, team: captainConflict };
  }

  const { error } = await supabase
    .from("teams")
    .update({
      captain_telegram_id: captain.telegramId,
      captain_chat_id: captain.chatId,
      captain_username: captain.username ?? null,
      captain_name: captainName,
      captain_bound_at: new Date().toISOString(),
    })
    .eq("id", teamId);

  if (error) {
    throw error;
  }

  await addEvent("captain", "captain.bound", teamId, {
    telegramId: captain.telegramId,
    username: captain.username,
    captainName,
  });

  return { status: "registered" as const, team: await getTeam(teamId) };
}

export async function autoAssignCaptain(
  captain: CaptainInput,
  requestedTeamId?: string,
) {
  const snapshot = await getSnapshot();
  const captainName = formatCaptainName(captain);
  const existingTeam = snapshot.teams.find(
    (team) =>
      team.captainTelegramId === String(captain.telegramId) ||
      team.captainChatId === String(captain.chatId),
  );

  if (existingTeam) {
    return { status: "already_registered" as const, team: existingTeam };
  }

  if (requestedTeamId) {
    const requestedTeam = snapshot.teams.find((team) => team.id === requestedTeamId);

    if (!requestedTeam) {
      return { status: "missing" as const, team: null };
    }

    if (requestedTeam.captainTelegramId || requestedTeam.captainChatId) {
      return { status: "already_taken" as const, team: requestedTeam };
    }

    return assignCaptainToTeam(requestedTeam.id, captain, captainName);
  }

  if (snapshot.game.status !== "waiting") {
    return { status: "registration_closed" as const, team: null };
  }

  const freeTeams = snapshot.teams
    .filter((team) => !team.captainTelegramId && !team.captainChatId)
    .sort((first, second) => first.number - second.number);

  for (const team of freeTeams) {
    const result = await assignCaptainToTeam(team.id, captain, captainName);

    if (result.status === "registered") {
      return result;
    }
  }

  return { status: "full" as const, team: null };
}

export async function releaseCaptain(teamId: string) {
  const supabase = getSupabaseServiceClient();
  const team = await getTeam(teamId);

  if (!team.captainTelegramId) {
    return;
  }

  const { error } = await supabase
    .from("teams")
    .update({
      captain_telegram_id: null,
      captain_chat_id: null,
      captain_username: null,
      captain_name: null,
      captain_bound_at: null,
    })
    .eq("id", teamId);

  if (error) {
    throw error;
  }

  await addEvent("organizer", "captain.released", teamId, {
    captainName: team.captainName,
    telegramId: team.captainTelegramId,
  });
}

async function assignCaptainToTeam(
  teamId: string,
  captain: CaptainInput,
  captainName: string,
) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("teams")
    .update({
      captain_telegram_id: captain.telegramId,
      captain_chat_id: captain.chatId,
      captain_username: captain.username ?? null,
      captain_name: captainName,
      captain_bound_at: new Date().toISOString(),
    })
    .eq("id", teamId)
    .is("captain_telegram_id", null)
    .is("captain_chat_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { status: "already_taken" as const, team: await getTeam(teamId) };
  }

  await addEvent("captain", "captain.auto_bound", teamId, {
    telegramId: captain.telegramId,
    username: captain.username,
    captainName,
  });

  return { status: "registered" as const, team: await getTeam(teamId) };
}

export async function markUpdateProcessed(updateId: number) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("processed_telegram_updates")
    .insert({ update_id: updateId })
    .select("update_id");

  if (error?.code === "23505") {
    return false;
  }

  if (error) {
    throw error;
  }

  return Boolean(data?.length);
}

export async function startGame(durationSeconds = 600) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();

  if (session.status === "running") {
    throw new Error("Игра уже запущена");
  }

  const openedAt = new Date();
  const deadlineAt = new Date(openedAt.getTime() + durationSeconds * 1000);
  const { error: sessionError } = await supabase
    .from("game_sessions")
    .update({
      status: "running",
      current_stage_index: 0,
      duration_seconds: durationSeconds,
      stage_opened_at: openedAt.toISOString(),
      deadline_at: deadlineAt.toISOString(),
    })
    .eq("id", session.id);

  if (sessionError) {
    throw sessionError;
  }

  await createProgressForStage(session.id, 0);
  await addEvent("organizer", "stage.opened", undefined, {
    stageIndex: 0,
    durationSeconds,
  });
}

export async function advanceGame(durationSeconds = 600) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();

  if (session.status !== "running") {
    throw new Error("Игра еще не запущена");
  }

  const snapshot = await getSnapshot();
  const blockers = snapshot.teams
    .filter((team) => team.captainTelegramId && team.status !== "ready")
    .map((team) => team.name);

  if (blockers.length) {
    const error = new Error("Не все команды завершили этап") as Error & {
      blockers?: string[];
    };
    error.blockers = blockers;
    throw error;
  }

  const nextStageIndex = session.current_stage_index + 1;

  if (nextStageIndex >= scenarioLength) {
    const { error } = await supabase
      .from("game_sessions")
      .update({
        status: "completed",
        current_stage_index: session.current_stage_index,
        stage_opened_at: null,
        deadline_at: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    if (error) {
      throw error;
    }

    await supabase
      .from("team_stage_progress")
      .update({ status: "completed" })
      .eq("session_id", session.id)
      .eq("stage_index", session.current_stage_index);
    await addEvent("organizer", "game.completed");
    return;
  }

  const openedAt = new Date();
  const deadlineAt = new Date(openedAt.getTime() + durationSeconds * 1000);
  const { error } = await supabase
    .from("game_sessions")
    .update({
      current_stage_index: nextStageIndex,
      duration_seconds: durationSeconds,
      stage_opened_at: openedAt.toISOString(),
      deadline_at: deadlineAt.toISOString(),
    })
    .eq("id", session.id);

  if (error) {
    throw error;
  }

  await createProgressForStage(session.id, nextStageIndex);
  await addEvent("organizer", "stage.opened", undefined, {
    stageIndex: nextStageIndex,
    durationSeconds,
  });
}

export async function resetGame() {
  const supabase = getSupabaseServiceClient();
  const snapshotBeforeReset = await getSnapshot();

  await Promise.all(
    snapshotBeforeReset.teams
      .filter((team) => team.captainTelegramId)
      .map((team) =>
        addEvent("system", "captain.snapshot", team.id, {
          captainName: team.captainName,
          telegramId: team.captainTelegramId,
        }),
      ),
  );

  await supabase
    .from("game_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      stage_opened_at: null,
      deadline_at: null,
    })
    .in("status", ["waiting", "running"]);

  const { error: teamsError } = await supabase.from("teams").update({
    captain_telegram_id: null,
    captain_chat_id: null,
    captain_username: null,
    captain_name: null,
    captain_bound_at: null,
  }).neq("id", "");

  if (teamsError) {
    throw teamsError;
  }

  const { error } = await supabase.from("game_sessions").insert({
    status: "waiting",
    current_stage_index: -1,
    duration_seconds: 600,
  });

  if (error) {
    throw error;
  }

  await addEvent("organizer", "game.reset");
}

export async function selectChoice(
  teamId: string,
  choiceId: string,
  source: DecisionSource = "captain",
) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  const team = await getTeam(teamId);

  if (!["awaiting-decision", "decision-selected"].includes(team.status)) {
    throw new Error("Решение уже зафиксировано или этап закрыт");
  }

  const choiceLabel = getChoiceLabel(team, choiceId);

  if (!choiceLabel) {
    throw new Error("Такого варианта нет в текущем сценарии команды");
  }

  const { error } = await supabase
    .from("team_stage_progress")
    .update({
      status: "decision-selected",
      selected_choice_id: choiceId,
      selected_choice_label: choiceLabel,
      selected_source: source,
      last_activity_at: new Date().toISOString(),
    })
    .eq("session_id", session.id)
    .eq("team_id", teamId)
    .eq("stage_index", session.current_stage_index);

  if (error) {
    throw error;
  }

  await addEvent(source === "captain" ? "captain" : "organizer", "decision.selected", teamId, {
    choiceId,
    choiceLabel,
  });

  return { choiceId, choiceLabel };
}

export async function answerBlueQ2Question(
  teamId: string,
  callbackData: string,
  source: DecisionSource = "captain",
) {
  const [, part, value] = callbackData.split(":");
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  const team = await getTeam(teamId);

  if (team.color !== "blue" || team.currentStageIndex !== 1) {
    throw new Error("Этот вопрос не относится к текущему этапу");
  }

  const nextDraft = applyBlueQ2Answer(team.blueQ2Draft ?? {}, part, value);
  const update = {
    q2_hire: nextDraft.hire ?? null,
    q2_pr: nextDraft.pr ?? null,
    q2_bonus: nextDraft.bonus ?? null,
    last_activity_at: new Date().toISOString(),
  };

  if (isCompleteBlueQ2Draft(nextDraft)) {
    const choiceId = getBlueQ2ChoiceId(nextDraft);
    const choiceLabel = getBlueQ2ChoiceLabel(nextDraft);
    const { error } = await supabase
      .from("team_stage_progress")
      .update({
        ...update,
        status: "decision-selected",
        selected_choice_id: choiceId,
        selected_choice_label: choiceLabel,
        selected_source: source,
      })
      .eq("session_id", session.id)
      .eq("team_id", teamId)
      .eq("stage_index", 1);

    if (error) {
      throw error;
    }

    await addEvent(source === "captain" ? "captain" : "organizer", "decision.selected", teamId, {
      choiceId,
      choiceLabel,
    });
    return { complete: true as const, choiceId, choiceLabel };
  }

  const { error } = await supabase
    .from("team_stage_progress")
    .update(update)
    .eq("session_id", session.id)
    .eq("team_id", teamId)
    .eq("stage_index", 1);

  if (error) {
    throw error;
  }

  await addEvent(source === "captain" ? "captain" : "organizer", "blue_q2.part_answered", teamId, {
    part,
    value,
  });
  return { complete: false as const };
}

export async function confirmChoice(teamId: string) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  const team = await getTeam(teamId);

  if (team.status !== "decision-selected" || !team.selectedChoiceId) {
    throw new Error("Сначала выберите решение");
  }

  const stage = getScenarioStage(team, session.current_stage_index);
  const now = new Date().toISOString();
  const nextStatus = stage.fileRequired ? "awaiting-file" : "ready";

  const { error: progressError } = await supabase
    .from("team_stage_progress")
    .update({
      status: nextStatus,
      decision_confirmed_at: now,
      last_activity_at: now,
    })
    .eq("session_id", session.id)
    .eq("team_id", teamId)
    .eq("stage_index", session.current_stage_index);

  if (progressError) {
    throw progressError;
  }

  const { error: decisionError } = await supabase.from("decisions").upsert(
    {
      session_id: session.id,
      team_id: teamId,
      stage_index: session.current_stage_index,
      stage_id: stage.id,
      choice_id: team.selectedChoiceId,
      choice_label: team.selectedChoiceLabel ?? team.selectedChoiceId,
      source: team.selectedSource ?? "captain",
      confirmed_at: now,
    },
    { onConflict: "session_id,team_id,stage_index" },
  );

  if (decisionError) {
    throw decisionError;
  }

  await addEvent(
    team.selectedSource === "organizer_override" ? "organizer" : "captain",
    "decision.confirmed",
    teamId,
    {
      choiceId: team.selectedChoiceId,
      choiceLabel: team.selectedChoiceLabel,
    },
  );

  return { stage, status: nextStatus };
}

export async function attachFile(teamId: string, file: TelegramFileInput) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  const team = await getTeam(teamId);

  if (!["awaiting-file", "ready"].includes(team.status)) {
    throw new Error("Сейчас файл не ожидается");
  }

  const { error: fileError } = await supabase.from("uploaded_files").insert({
    session_id: session.id,
    team_id: teamId,
    stage_index: session.current_stage_index,
    telegram_file_id: file.telegramFileId,
    telegram_file_unique_id: file.telegramFileUniqueId,
    file_name: file.fileName,
    mime_type: file.mimeType,
    file_size: file.fileSize,
    storage_bucket: file.storageBucket ?? null,
    storage_path: file.storagePath ?? null,
  });

  if (fileError) {
    throw fileError;
  }

  const fileUrl = file.storagePath ?? `telegram-file:${file.telegramFileId}`;
  const { error: progressError } = await supabase
    .from("team_stage_progress")
    .update({
      status: "ready",
      file_name: file.fileName,
      file_url: fileUrl,
      last_activity_at: new Date().toISOString(),
    })
    .eq("session_id", session.id)
    .eq("team_id", teamId)
    .eq("stage_index", session.current_stage_index);

  if (progressError) {
    throw progressError;
  }

  await addEvent("captain", "file.uploaded", teamId, {
    fileName: file.fileName,
  });
}

export async function forceResolve(teamId: string, choiceId: string) {
  if (choiceId.startsWith("blueq2:")) {
    const result = await answerBlueQ2Question(teamId, choiceId, "organizer_override");

    if (!result.complete) {
      return;
    }

    choiceId = result.choiceId;
  } else {
    await selectChoice(teamId, choiceId, "organizer_override");
  }

  await confirmChoice(teamId);

  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  await supabase
    .from("team_stage_progress")
    .update({
      status: "ready",
      file_missing_on_forced_advance: true,
      last_activity_at: new Date().toISOString(),
    })
    .eq("session_id", session.id)
    .eq("team_id", teamId)
    .eq("stage_index", session.current_stage_index);

  await addEvent("organizer", "decision.forced", teamId, {
    choiceId,
    choiceLabel: (await getTeam(teamId)).selectedChoiceLabel,
  });
}

export async function setDelivery(
  teamId: string,
  status: "sent" | "failed",
  error?: string,
) {
  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  const { error: insertError } = await supabase.from("delivery_attempts").insert({
    session_id: session.id,
    team_id: teamId,
    stage_index: session.current_stage_index,
    message_kind: "stage",
    status,
    error_code: error?.slice(0, 500) ?? null,
  });

  if (insertError) {
    throw insertError;
  }
}

export async function addEvent(
  actor: "captain" | "organizer" | "system",
  action: string,
  teamId?: string,
  details: Record<string, unknown> = {},
) {
  if (!hasSupabaseConfig()) {
    return;
  }

  const supabase = getSupabaseServiceClient();
  const session = await getOrCreateSession();
  await supabase.from("bot_events").insert({
    session_id: session.id,
    team_id: teamId ?? null,
    actor_type: actor,
    event_type: action,
    payload: details,
  });
}

async function getOrCreateSession() {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("game_sessions")
    .select("*")
    .in("status", ["waiting", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as SessionRow;
  }

  const { data: created, error: createError } = await supabase
    .from("game_sessions")
    .insert({
      status: "waiting",
      current_stage_index: -1,
      duration_seconds: 600,
    })
    .select("*")
    .single();

  if (createError) {
    throw createError;
  }

  return created as SessionRow;
}

async function createProgressForStage(sessionId: string, stageIndex: number) {
  const supabase = getSupabaseServiceClient();
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id");

  if (teamsError) {
    throw teamsError;
  }

  const rows = (teams ?? []).map((team) => ({
    session_id: sessionId,
    team_id: String(team.id),
    stage_index: stageIndex,
    status: "awaiting-decision",
  }));

  if (!rows.length) {
    return;
  }

  const { error } = await supabase.from("team_stage_progress").upsert(rows, {
    onConflict: "session_id,team_id,stage_index",
  });

  if (error) {
    throw error;
  }
}

function mapGameState(row: SessionRow): GameState {
  return {
    id: row.id,
    status: row.status as GameState["status"],
    currentStageIndex: row.current_stage_index,
    durationSeconds: row.duration_seconds,
    stageOpenedAt: row.stage_opened_at ?? undefined,
    deadlineAt: row.deadline_at ?? undefined,
  };
}

function mapTeamState(
  team: TeamRow,
  session: SessionRow,
  progress: ProgressRow | undefined,
  history: DecisionRecord[],
  delivery: DeliveryState | undefined,
  latestFile: { id: string; name: string; url: string } | undefined,
): TeamState {
  const currentStageIndex = session.current_stage_index;
  const status =
    session.status === "waiting"
      ? "waiting"
      : session.status === "completed"
        ? "completed"
        : ((progress?.status as TeamState["status"]) ?? "awaiting-decision");

  return {
    id: team.id,
    number: Number(team.team_number),
    name: team.name,
    color: team.color,
    captainTelegramId: team.captain_telegram_id
      ? String(team.captain_telegram_id)
      : undefined,
    captainChatId: team.captain_chat_id ? String(team.captain_chat_id) : undefined,
    captainName: team.captain_name ?? undefined,
    status,
    currentStageIndex,
    selectedChoiceId: progress?.selected_choice_id ?? undefined,
    selectedChoiceLabel: progress?.selected_choice_label ?? undefined,
    selectedSource: progress?.selected_source ?? undefined,
    decisionConfirmedAt: progress?.decision_confirmed_at ?? undefined,
    currentFileId: latestFile?.id,
    currentFileName: progress?.file_name ?? latestFile?.name,
    currentFileUrl: progress?.file_url ?? latestFile?.url,
    lastActivityAt: progress?.last_activity_at ?? undefined,
    delivery: delivery ?? { status: "not-sent" },
    blueQ2Draft: {
      hire: progress?.q2_hire ?? undefined,
      pr: progress?.q2_pr ?? undefined,
      bonus: progress?.q2_bonus ?? undefined,
    },
    history,
  };
}

function mapDecision(row: DecisionRow): DecisionRecord {
  return {
    teamId: row.team_id,
    stageIndex: row.stage_index,
    stageId: row.stage_id,
    choiceId: row.choice_id,
    choiceLabel: row.choice_label,
    source: row.source,
    confirmedAt: row.confirmed_at,
    fileMissingOnForcedAdvance: Boolean(row.file_missing_on_forced_advance),
  };
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    at: row.created_at,
    actor: row.actor_type,
    action: row.event_type,
    teamId: row.team_id ?? undefined,
    details: row.payload,
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }

  return map;
}

function readStringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function formatCaptainName(captain: CaptainInput) {
  const fullName = [captain.firstName, captain.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) {
    return fullName;
  }

  if (captain.username) {
    return `@${captain.username}`;
  }

  return String(captain.telegramId);
}
