import type { GameSnapshot, TeamState } from "./game-types";
import { getScenarioStage } from "./scenario";

const serverNow = new Date().toISOString();

export function createMockSnapshot(): GameSnapshot {
  const teams: TeamState[] = Array.from({ length: 7 }, (_, index) => {
    const number = index + 1;
    const color = number <= 4 ? "red" : "blue";

    return {
      id: `team-${number}`,
      number,
      name: `Команда ${number}`,
      color,
      status: "waiting",
      currentStageIndex: -1,
      delivery: { status: "not-sent" },
      history: [],
    };
  });

  return {
    game: {
      status: "waiting",
      currentStageIndex: -1,
      durationSeconds: 600,
    },
    teams,
    audit: [
      {
        id: "mock-event-1",
        at: serverNow,
        actor: "system",
        action: "demo.snapshot",
        details: { note: "Supabase env не задан, показаны демо-данные" },
      },
    ],
    serverNow,
    source: "mock",
  };
}

export function getMockCurrentChoices(team: TeamState) {
  if (team.currentStageIndex < 0 || team.currentStageIndex >= 4) {
    return [];
  }

  return getScenarioStage(team, team.currentStageIndex).choices;
}
