"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  ClipboardList,
  RefreshCw,
  RotateCcw,
  Send,
  Users,
} from "lucide-react";
import type { AuditEvent, GameSnapshot, TeamColor, TeamState } from "@/lib/game-types";
import { getBotPrompt, getScenarioStage } from "@/lib/scenario";

type AdminDashboardProps = {
  initialData: GameSnapshot;
  authMode: "open" | "token";
  adminToken: string;
  loadError?: string;
};

const statusLabels: Record<TeamState["status"], string> = {
  waiting: "Ожидает старта",
  "awaiting-decision": "Принимает решение",
  "decision-selected": "Выбор сделан",
  "awaiting-file": "Загружает файл",
  ready: "Готова",
  completed: "Завершено",
};

export function AdminDashboard({
  initialData,
  authMode,
  adminToken,
  loadError,
}: AdminDashboardProps) {
  const [snapshot, setSnapshot] = useState(initialData);
  const [error, setError] = useState(loadError);
  const [stageDurationMinutes, setStageDurationMinutes] = useState(
    Math.max(1, initialData.game.durationSeconds / 60),
  );
  const [isGlobalActionPending, setIsGlobalActionPending] = useState(false);
  const [pendingTeamIds, setPendingTeamIds] = useState<Set<string>>(new Set());

  const readyCount = snapshot.teams.filter((team) => team.status === "ready").length;
  const connectedCount = snapshot.teams.filter((team) => team.captainTelegramId).length;
  const secondsLeft = getSecondsLeft(snapshot.game.deadlineAt, snapshot.serverNow);
  const teamsById = useMemo(
    () => new Map(snapshot.teams.map((team) => [team.id, team])),
    [snapshot.teams],
  );

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/dashboard${tokenQuery(adminToken)}`, {
      cache: "no-store",
      headers: adminToken ? { "x-admin-token": adminToken } : undefined,
    });
    const data = (await response.json()) as GameSnapshot & { loadError?: string; error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Не удалось обновить панель");
    }

    setSnapshot(data);
    setError(data.loadError);
  }, [adminToken]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить панель");
        });
      }
    }, 2500);

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refresh().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : "Не удалось обновить панель");
        });
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  async function submitAction(payload: Record<string, unknown>) {
    const response = await fetch(`/api/admin/action${tokenQuery(adminToken)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(adminToken ? { "x-admin-token": adminToken } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as GameSnapshot & {
      error?: string;
      blockers?: string[];
    };

    if (!response.ok) {
      const blockers = data.blockers?.length
        ? ` Блокеры: ${data.blockers.join(", ")}.`
        : "";
      throw new Error(`${data.error ?? "Команда не выполнена"}.${blockers}`);
    }

    setSnapshot(data);
  }

  function setTeamPending(teamId: string, value: boolean) {
    setPendingTeamIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (value) {
        nextIds.add(teamId);
      } else {
        nextIds.delete(teamId);
      }

      return nextIds;
    });
  }

  function action(payload: Record<string, unknown>) {
    const teamId = typeof payload.teamId === "string" ? payload.teamId : undefined;

    setError(undefined);
    if (teamId) {
      setTeamPending(teamId, true);
    } else {
      setIsGlobalActionPending(true);
    }

    void submitAction(payload)
      .catch((actionError) => {
        setError(actionError instanceof Error ? actionError.message : "Ошибка команды");
      })
      .finally(() => {
        if (teamId) {
          setTeamPending(teamId, false);
        } else {
          setIsGlobalActionPending(false);
        }
      });
  }

  return (
    <main className="min-h-screen bg-[#f3f3f8] text-slate-950">
      <section className="mx-auto max-w-6xl px-4 py-7">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 text-white shadow-sm">
              <Bot className="h-8 w-8" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Финансовая деловая игра
              </div>
              <h1 className="mt-1 text-4xl font-black tracking-normal">
                Лига лидеров
              </h1>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="icon-button"
              disabled={isGlobalActionPending}
              onClick={() =>
                void refresh().catch((refreshError) => {
                  setError(
                    refreshError instanceof Error
                      ? refreshError.message
                      : "Не удалось обновить панель",
                  );
                })
              }
              title="Обновить"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              className="secondary-button"
              disabled={isGlobalActionPending}
              onClick={() => {
                if (window.confirm("Сбросить текущую игру и освободить команды?")) {
                  action({ type: "reset" });
                }
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Сбросить
            </button>
          </div>
        </header>

        <section className="mb-5 grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:grid-cols-[1fr_1fr_1fr_1fr_1.3fr]">
          <Metric title="Текущий статус" value={gameStatus(snapshot)} />
          <Metric title="Готовность" value={`${readyCount} / ${snapshot.teams.length} команд`} />
          <Metric title="Капитаны" value={`${connectedCount} / ${snapshot.teams.length}`} />
          <Metric title="Осталось времени" value={formatSeconds(secondsLeft)} />
          <div className="flex flex-col gap-3 border-t border-slate-200 p-4 md:border-l md:border-t-0">
            <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Следующий этап, минут
            </label>
            <div className="flex gap-3">
              <input
                className="h-11 w-24 rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-900"
                min={1}
                max={1440}
                type="number"
                value={stageDurationMinutes}
                onChange={(event) => setStageDurationMinutes(Number(event.target.value))}
              />
              <button
                className="primary-button flex-1"
                disabled={isGlobalActionPending || !Number.isFinite(stageDurationMinutes)}
                onClick={() =>
                  action({
                    type: snapshot.game.status === "waiting" ? "start" : "advance",
                    durationSeconds: Math.max(1, stageDurationMinutes) * 60,
                  })
                }
              >
                {snapshot.game.status === "waiting"
                  ? "Открыть первый этап"
                  : "Завершить этап и перейти дальше"}
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
            <ClipboardList className="h-4 w-4" />
            Пульт организатора
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <AdminHint
              title="Текущий этап"
              value={getDashboardStageTitle(snapshot)}
            />
            <AdminHint
              title="Что делать сейчас"
              value={getDashboardNextAction(snapshot)}
            />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <TeamColumn
            color="red"
            teams={snapshot.teams.filter((team) => team.color === "red")}
            globalBusy={isGlobalActionPending}
            pendingTeamIds={pendingTeamIds}
            adminToken={adminToken}
            onAction={action}
          />
          <TeamColumn
            color="blue"
            teams={snapshot.teams.filter((team) => team.color === "blue")}
            globalBusy={isGlobalActionPending}
            pendingTeamIds={pendingTeamIds}
            adminToken={adminToken}
            onAction={action}
          />
        </div>

        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
            <Clock className="h-4 w-4" />
            Журнал
          </div>
          <div className="grid gap-2 text-sm">
            {snapshot.audit.length ? (
              snapshot.audit.slice(0, 12).map((event) => {
                const audit = formatAuditEvent(event, teamsById);

                return (
                  <div
                    key={event.id}
                    className="grid gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 md:grid-cols-[120px_150px_1fr]"
                  >
                    <span className="text-slate-500">{formatDate(event.at)}</span>
                    <span className="font-semibold">{audit.subject}</span>
                    <span>
                      <span className="font-semibold">{audit.title}</span>
                      {audit.detail ? (
                        <span className="text-slate-600"> — {audit.detail}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-slate-500">
                Событий пока нет.
              </div>
            )}
          </div>
        </section>

        <footer className="mt-5 flex flex-wrap gap-2 text-xs text-slate-500">
          <span>Источник: {snapshot.source === "supabase" ? "Supabase" : "демо"}</span>
          <span>{authMode === "token" ? "Admin token включен" : "Admin token не задан"}</span>
        </footer>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="border-t border-slate-200 p-4 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-lg font-black">{value}</div>
    </div>
  );
}

function AdminHint({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug">{value}</div>
    </div>
  );
}

function TeamColumn({
  color,
  teams,
  globalBusy,
  pendingTeamIds,
  adminToken,
  onAction,
}: {
  color: TeamColor;
  teams: TeamState[];
  globalBusy: boolean;
  pendingTeamIds: Set<string>;
  adminToken: string;
  onAction: (payload: Record<string, unknown>) => void;
}) {
  return (
    <section>
      <div
        className={`mb-3 flex items-center justify-between rounded-lg px-4 py-3 text-sm font-black uppercase tracking-[0.08em] ${
          color === "red"
            ? "bg-red-100 text-red-900"
            : "bg-blue-100 text-blue-900"
        }`}
      >
        <span>{color === "red" ? "Красные команды" : "Синие команды"}</span>
        <span>{teams.length}</span>
      </div>
      <div className="space-y-4">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            busy={globalBusy || pendingTeamIds.has(team.id)}
            adminToken={adminToken}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}

function TeamCard({
  team,
  busy,
  adminToken,
  onAction,
}: {
  team: TeamState;
  busy: boolean;
  adminToken: string;
  onAction: (payload: Record<string, unknown>) => void;
}) {
  const choices = useMemo(() => {
    if (team.currentStageIndex < 0 || team.status === "completed") {
      return [];
    }

    return getBotPrompt(team).choices;
  }, [team]);
  const fileHref = team.currentFileId
    ? `/api/admin/files/${team.currentFileId}${tokenQuery(adminToken)}`
    : undefined;
  const adminDecisionTitle = getAdminDecisionTitle(team);
  const stageTitle = getTeamStageTitle(team);
  const nextAction = getTeamNextAction(team);

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        team.color === "red" ? "border-l-4 border-l-red-500" : "border-l-4 border-l-blue-600"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{team.name}</h3>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            {statusLabels[team.status]}
          </div>
          <div className="mt-1 text-xs font-bold text-slate-700">{stageTitle}</div>
        </div>
        <StatusPill status={team.status} />
      </div>

      <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
        <span className="font-black text-slate-500">Сейчас: </span>
        <span className="font-semibold">{nextAction}</span>
      </div>

      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 text-sm">
        <InfoCell
          complete={Boolean(team.captainTelegramId)}
          label="Капитан"
          value={team.captainName ?? "Не подключён"}
        />
        <InfoCell
          complete={Boolean(team.selectedChoiceId)}
          label="Решение"
          value={team.selectedChoiceLabel ?? "—"}
        />
        <InfoCell
          complete={Boolean(team.currentFileName)}
          label="Файл"
          value={team.currentFileName ?? "—"}
          href={fileHref}
        />
        <InfoCell
          complete={team.delivery.status === "sent"}
          label="Доставка"
          value={deliveryText(team)}
        />
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="small-button"
          disabled={busy || !team.captainChatId || team.currentStageIndex < 0}
          onClick={() => onAction({ type: "resend", teamId: team.id })}
        >
          <Send className="h-3.5 w-3.5" />
          Повторить этап
        </button>
      </div>

      {choices.length && team.status !== "ready" && team.status !== "completed" ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
            {adminDecisionTitle}
          </div>
          <div className="grid gap-2">
            {choices.map((choice) => (
              <button
                key={choice.id}
                className="force-button"
                disabled={busy}
                onClick={() =>
                  onAction({ type: "force", teamId: team.id, choiceId: choice.id })
                }
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function InfoCell({
  label,
  value,
  complete,
  href,
}: {
  label: string;
  value: string;
  complete: boolean;
  href?: string;
}) {
  return (
    <div className={complete ? "complete-cell" : "info-cell"}>
      <dt className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 min-h-5 break-words font-bold">
        {href ? (
          <a className="text-blue-700 underline-offset-2 hover:underline" href={href}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function StatusPill({ status }: { status: TeamState["status"] }) {
  const isReady = status === "ready" || status === "completed";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        isReady
          ? "bg-emerald-50 text-emerald-800"
          : "bg-slate-100 text-slate-600"
      }`}
    >
      {isReady ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
      {statusLabels[status]}
    </span>
  );
}

function getAdminDecisionTitle(team: TeamState) {
  if (team.color !== "blue" || team.currentStageIndex !== 1) {
    return "Решение организатора";
  }

  if (typeof team.blueQ2Draft?.hire !== "boolean") {
    return "Q2: нанимаем 2 СК?";
  }

  if (typeof team.blueQ2Draft?.pr !== "boolean") {
    return "Q2: делаем PR?";
  }

  if (typeof team.blueQ2Draft?.bonus !== "boolean") {
    return "Q2: платим аванс бонуса?";
  }

  return "Решение организатора";
}

function getTeamStageTitle(team: TeamState) {
  if (team.currentStageIndex < 0) {
    return "Этап ещё не открыт";
  }

  try {
    const stage = getScenarioStage(team, team.currentStageIndex);
    return `${team.currentStageIndex + 1}. ${stage.title}`;
  } catch {
    return `Этап ${team.currentStageIndex + 1}`;
  }
}

function getTeamNextAction(team: TeamState) {
  if (!team.captainTelegramId) {
    return "капитан ещё не подключился через /start";
  }

  if (team.status === "waiting") {
    return "ждёт старта игры от организатора";
  }

  if (team.status === "awaiting-decision") {
    return team.color === "blue" && team.currentStageIndex === 1
      ? getAdminDecisionTitle(team).replace("Q2: ", "капитан отвечает: ")
      : "капитан выбирает вариант в Telegram";
  }

  if (team.status === "decision-selected") {
    return "капитан выбрал вариант, но ещё не нажал «Подтвердить»";
  }

  if (team.status === "awaiting-file") {
    return "решение подтверждено, ждём Excel-файл бюджета";
  }

  if (team.status === "ready") {
    return "команда готова к следующему этапу";
  }

  return "игра для команды завершена";
}

function getDashboardStageTitle(snapshot: GameSnapshot) {
  if (snapshot.game.status === "waiting") {
    return "игра ещё не начата";
  }

  if (snapshot.game.status === "completed") {
    return "игра завершена";
  }

  return `этап ${snapshot.game.currentStageIndex + 1} из 4`;
}

function getDashboardNextAction(snapshot: GameSnapshot) {
  if (snapshot.game.status === "waiting") {
    return "нажать «Открыть первый этап», когда капитаны подключились";
  }

  if (snapshot.game.status === "completed") {
    return "можно скачать файлы и анализировать решения";
  }

  const waitingDecision = snapshot.teams.filter(
    (team) => team.status === "awaiting-decision" || team.status === "decision-selected",
  ).length;
  const waitingFiles = snapshot.teams.filter((team) => team.status === "awaiting-file").length;
  const ready = snapshot.teams.filter((team) => team.status === "ready").length;

  if (waitingDecision > 0) {
    return `ждём решения: ${waitingDecision}; Excel: ${waitingFiles}; готово: ${ready}`;
  }

  if (waitingFiles > 0) {
    return `решения есть, ждём Excel-файлы: ${waitingFiles}; готово: ${ready}`;
  }

  return "все готовы — можно завершать этап и открывать следующий";
}

function formatAuditEvent(
  event: AuditEvent,
  teamsById: Map<string, TeamState>,
) {
  const team = event.teamId ? teamsById.get(event.teamId) : undefined;
  const subject = team?.name ?? actorLabel(event.actor);

  if (event.action === "stage.opened") {
    return {
      subject: "Организатор",
      title: "Открыл этап",
      detail: formatStageDetail(event.details?.stageIndex),
    };
  }

  if (event.action === "game.completed") {
    return {
      subject: "Организатор",
      title: "Завершил игру",
      detail: "",
    };
  }

  if (event.action === "game.reset") {
    return {
      subject: "Организатор",
      title: "Сбросил игру",
      detail: "команды освобождены, создана новая сессия",
    };
  }

  if (event.action === "captain.bound" || event.action === "captain.auto_bound") {
    return {
      subject,
      title: "Капитан подключился",
      detail: "команда занята",
    };
  }

  if (event.action === "decision.selected") {
    return {
      subject,
      title: event.actor === "organizer" ? "Организатор выбрал решение" : "Капитан выбрал решение",
      detail: readTextDetail(event.details?.choiceLabel ?? event.details?.choiceId),
    };
  }

  if (event.action === "blue_q2.part_answered") {
    return {
      subject,
      title: event.actor === "organizer" ? "Организатор ответил на Q2" : "Капитан ответил на Q2",
      detail: `${blueQ2PartLabel(event.details?.part)}: ${yesNoLabel(event.details?.value)}`,
    };
  }

  if (event.action === "decision.confirmed") {
    return {
      subject,
      title: event.actor === "organizer" ? "Организатор подтвердил решение" : "Капитан подтвердил решение",
      detail: readTextDetail(event.details?.choiceLabel ?? event.details?.choiceId),
    };
  }

  if (event.action === "decision.forced") {
    return {
      subject,
      title: "Организатор закрыл команду вручную",
      detail: readTextDetail(event.details?.choiceLabel ?? event.details?.choiceId),
    };
  }

  if (event.action === "file.uploaded") {
    return {
      subject,
      title: "Excel-файл загружен",
      detail: readTextDetail(event.details?.fileName),
    };
  }

  return {
    subject,
    title: event.action,
    detail: "",
  };
}

function actorLabel(actor: AuditEvent["actor"]) {
  if (actor === "captain") {
    return "Капитан";
  }

  if (actor === "organizer") {
    return "Организатор";
  }

  return "Система";
}

function formatStageDetail(stageIndex: unknown) {
  return typeof stageIndex === "number" ? `этап ${stageIndex + 1}` : "";
}

function readTextDetail(value: unknown) {
  return typeof value === "string" ? value : "";
}

function blueQ2PartLabel(part: unknown) {
  if (part === "hire") {
    return "найм 2 СК";
  }

  if (part === "pr") {
    return "PR";
  }

  if (part === "bonus") {
    return "аванс бонуса";
  }

  return "вопрос";
}

function yesNoLabel(value: unknown) {
  if (value === "yes" || value === true) {
    return "да";
  }

  if (value === "no" || value === false) {
    return "нет";
  }

  return "—";
}

function gameStatus(snapshot: GameSnapshot) {
  if (snapshot.game.status === "waiting") {
    return "Игра не начата";
  }

  if (snapshot.game.status === "completed") {
    return "Игра завершена";
  }

  return `Этап ${snapshot.game.currentStageIndex + 1} / 4`;
}

function deliveryText(team: TeamState) {
  if (team.delivery.status === "not-sent") {
    return "—";
  }

  if (team.delivery.status === "failed") {
    return team.delivery.error ?? "Ошибка";
  }

  return team.delivery.at ? `Отправлено ${formatDate(team.delivery.at)}` : "Отправлено";
}

function formatSeconds(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value <= 0) {
    return "00:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSecondsLeft(deadlineAt: string | undefined, serverNow: string) {
  if (!deadlineAt) {
    return null;
  }

  return Math.max(
    0,
    Math.floor((new Date(deadlineAt).getTime() - new Date(serverNow).getTime()) / 1000),
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tokenQuery(token: string) {
  return token ? `?token=${encodeURIComponent(token)}` : "";
}
