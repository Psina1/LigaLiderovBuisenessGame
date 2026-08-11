export type TeamColor = "red" | "blue";

export type GameStatus = "waiting" | "running" | "completed";

export type TeamStatus =
  | "waiting"
  | "awaiting-decision"
  | "decision-selected"
  | "awaiting-file"
  | "ready"
  | "completed";

export type DeliveryStatus = "not-sent" | "sent" | "failed";

export type DecisionSource = "captain" | "organizer_override";

export type Choice = {
  id: string;
  label: string;
};

export type ScenarioStage = {
  id: string;
  title: string;
  situation: string;
  choices: Choice[];
  fileRequired: boolean;
};

export type DecisionRecord = {
  teamId: string;
  stageIndex: number;
  stageId: string;
  choiceId: string;
  choiceLabel: string;
  source: DecisionSource;
  confirmedAt: string;
  fileName?: string;
  fileUrl?: string;
  fileMissingOnForcedAdvance?: boolean;
};

export type DeliveryState = {
  status: DeliveryStatus;
  at?: string;
  error?: string;
};

export type BlueQ2Draft = {
  hire?: boolean;
  pr?: boolean;
  bonus?: boolean;
};

export type TeamState = {
  id: string;
  number: number;
  name: string;
  color: TeamColor;
  captainTelegramId?: string;
  captainChatId?: string;
  captainName?: string;
  status: TeamStatus;
  currentStageIndex: number;
  selectedChoiceId?: string;
  selectedChoiceLabel?: string;
  selectedSource?: DecisionSource;
  decisionConfirmedAt?: string;
  currentFileId?: string;
  currentFileName?: string;
  currentFileUrl?: string;
  lastActivityAt?: string;
  delivery: DeliveryState;
  blueQ2Draft?: BlueQ2Draft;
  history: DecisionRecord[];
};

export type GameState = {
  id?: string;
  status: GameStatus;
  currentStageIndex: number;
  stageOpenedAt?: string;
  deadlineAt?: string;
  durationSeconds: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: "captain" | "organizer" | "system";
  action: string;
  teamId?: string;
  details?: Record<string, unknown>;
};

export type GameSnapshot = {
  game: GameState;
  teams: TeamState[];
  audit: AuditEvent[];
  serverNow: string;
  source: "supabase" | "mock";
};

export type FileArchiveItem = {
  id: string;
  sessionId: string;
  sessionStatus: GameStatus;
  sessionStartedAt: string;
  sessionCompletedAt?: string;
  teamId: string;
  teamName: string;
  teamNumber: number;
  teamColor: TeamColor;
  captainName?: string;
  captainTelegramId?: string;
  stageIndex: number;
  fileName: string;
  receivedAt: string;
};

export type BotPrompt = {
  stage: ScenarioStage;
  text: string;
  choices: Choice[];
  mode: "stage-choice" | "blue-q2-question";
};
