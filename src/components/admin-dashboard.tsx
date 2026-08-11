"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  Send,
  Users,
} from "lucide-react";
import type { GameSnapshot, TeamColor, TeamState } from "@/lib/game-types";
import { getBotPrompt } from "@/lib/scenario";

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
  const [isPending, startTransition] = useTransition();

  const readyCount = snapshot.teams.filter((team) => team.status === "ready").length;
  const connectedCount = snapshot.teams.filter((team) => team.captainTelegramId).length;
  const secondsLeft = getSecondsLeft(snapshot.game.deadlineAt, snapshot.serverNow);

  async function refresh() {
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
  }

  function action(payload: Record<string, unknown>) {
    startTransition(async () => {
      try {
        setError(undefined);
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
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Ошибка команды");
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
              disabled={isPending}
              onClick={() => startTransition(refresh)}
              title="Обновить"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              className="secondary-button"
              disabled={isPending}
              onClick={() => action({ type: "reset" })}
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
                disabled={isPending || !Number.isFinite(stageDurationMinutes)}
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

        <div className="grid gap-5 lg:grid-cols-2">
          <TeamColumn
            color="red"
            teams={snapshot.teams.filter((team) => team.color === "red")}
            busy={isPending}
            onAction={action}
          />
          <TeamColumn
            color="blue"
            teams={snapshot.teams.filter((team) => team.color === "blue")}
            busy={isPending}
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
              snapshot.audit.slice(0, 12).map((event) => (
                <div
                  key={event.id}
                  className="grid gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 md:grid-cols-[120px_120px_1fr]"
                >
                  <span className="text-slate-500">{formatDate(event.at)}</span>
                  <span className="font-semibold">{event.teamId ?? event.actor}</span>
                  <span>{event.action}</span>
                </div>
              ))
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

function TeamColumn({
  color,
  teams,
  busy,
  onAction,
}: {
  color: TeamColor;
  teams: TeamState[];
  busy: boolean;
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
          <TeamCard key={team.id} team={team} busy={busy} onAction={onAction} />
        ))}
      </div>
    </section>
  );
}

function TeamCard({
  team,
  busy,
  onAction,
}: {
  team: TeamState;
  busy: boolean;
  onAction: (payload: Record<string, unknown>) => void;
}) {
  const choices = useMemo(() => {
    if (team.currentStageIndex < 0 || team.status === "completed") {
      return [];
    }

    return getBotPrompt(team).stage.choices;
  }, [team]);

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
        </div>
        <StatusPill status={team.status} />
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
            Решение организатора
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
}: {
  label: string;
  value: string;
  complete: boolean;
}) {
  return (
    <div className={complete ? "complete-cell" : "info-cell"}>
      <dt className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 min-h-5 break-words font-bold">{value}</dd>
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
