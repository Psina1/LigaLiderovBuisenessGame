import {
  answerBlueQ2Question,
  attachFile,
  bindCaptain,
  confirmChoice,
  getActiveTeams,
  getSnapshot,
  getTeamByCaptainTelegramId,
  markUpdateProcessed,
  selectChoice,
  setDelivery,
} from "./game-data";
import { getSupabaseServiceClient } from "./supabase-server";
import {
  answerCallbackQuery,
  downloadTelegramFile,
  getTelegramFilePath,
  sendTelegramMessage,
  type TelegramCallbackQuery,
  type TelegramDocument,
  type TelegramMessage,
  type TelegramUpdate,
} from "./telegram";
import type { TeamState } from "./game-types";
import { getBotPrompt, scenarioLength } from "./scenario";

const excelExtensions = new Set([".xlsx", ".xls", ".csv"]);

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (Number.isInteger(update.update_id)) {
    const isFirstTime = await markUpdateProcessed(update.update_id);

    if (!isFirstTime) {
      return { ok: true, duplicate: true };
    }
  }

  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query);
  }

  if (update.message) {
    return handleMessage(update.message);
  }

  return { ok: true };
}

async function handleMessage(message: TelegramMessage) {
  if (!message.from) {
    return { ok: true };
  }

  if (message.text?.startsWith("/start")) {
    const requestedTeamId = message.text.split(/\s+/)[1];

    if (requestedTeamId?.startsWith("team-")) {
      await registerCaptain(message, requestedTeamId);
      return { ok: true };
    }

    await sendTeamPicker(message.chat.id);
    return { ok: true };
  }

  if (message.document) {
    await handleDocumentMessage(message, message.document);
    return { ok: true };
  }

  await sendTelegramMessage(
    message.chat.id,
    "Нажмите /start, выберите команду и дальше отвечайте на задания кнопками.",
  );

  return { ok: true };
}

async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    await answerCallbackQuery(callbackQuery.id);
    return { ok: true };
  }

  if (data.startsWith("join:")) {
    await registerCaptainFromCallback(callbackQuery, chatId, data.slice("join:".length));
    return { ok: true };
  }

  const team = await getTeamByCaptainTelegramId(callbackQuery.from.id);

  if (!team) {
    await answerCallbackQuery(callbackQuery.id, "Сначала выберите команду");
    await sendTelegramMessage(chatId, "Нажмите /start и выберите свою команду.");
    return { ok: true };
  }

  if (data.startsWith("blueq2:")) {
    await handleBlueQ2Answer(callbackQuery, chatId, team, data);
    return { ok: true };
  }

  if (data.startsWith("pick:")) {
    await handleChoice(callbackQuery, chatId, team, data);
    return { ok: true };
  }

  if (data === "confirm") {
    await handleChoiceConfirmation(callbackQuery, chatId, team);
    return { ok: true };
  }

  await answerCallbackQuery(callbackQuery.id, "Неизвестная команда");
  return { ok: true };
}

async function sendTeamPicker(chatId: number) {
  const teams = await getActiveTeams();

  await sendTelegramMessage(chatId, "Выберите вашу команду:", {
    replyMarkup: {
      inline_keyboard: teams.map((team) => [
        {
          text: team.captainTelegramId
            ? `${team.name} уже занята`
            : `${team.name} (${team.color === "red" ? "красная" : "синяя"})`,
          callback_data: `join:${team.id}`,
        },
      ]),
    },
  });
}

async function registerCaptain(message: TelegramMessage, teamId: string) {
  if (!message.from) {
    return;
  }

  const result = await bindCaptain(teamId, {
    telegramId: message.from.id,
    chatId: message.chat.id,
    username: message.from.username,
    firstName: message.from.first_name,
    lastName: message.from.last_name,
  });

  await respondToRegistrationResult(message.chat.id, result);
}

async function registerCaptainFromCallback(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
  teamId: string,
) {
  const result = await bindCaptain(teamId, {
    telegramId: callbackQuery.from.id,
    chatId,
    username: callbackQuery.from.username,
    firstName: callbackQuery.from.first_name,
    lastName: callbackQuery.from.last_name,
  });

  await answerCallbackQuery(
    callbackQuery.id,
    result.status === "registered" ? "Команда привязана" : "Не удалось привязать",
  );
  await respondToRegistrationResult(chatId, result);
}

async function respondToRegistrationResult(
  chatId: number,
  result: Awaited<ReturnType<typeof bindCaptain>>,
) {
  if (result.status === "missing" || !result.team) {
    await sendTelegramMessage(chatId, "Команда не найдена. Напишите организатору.");
    return;
  }

  if (result.status === "already_taken") {
    await sendTelegramMessage(
      chatId,
      `${result.team.name} уже привязана к другому капитану. Если это ошибка, скажите организатору.`,
    );
    return;
  }

  if (result.status === "captain_conflict") {
    await sendTelegramMessage(
      chatId,
      `Вы уже привязаны к ${result.team.name}. Один капитан может вести только одну команду.`,
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    `<b>${escapeHtml(result.team.name)}</b> подключена. Ждите старта игры от организатора.`,
  );

  if (result.team.currentStageIndex >= 0 && result.team.currentStageIndex < scenarioLength) {
    await sendCurrentStage(result.team);
  }
}

async function handleChoice(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
  team: TeamState,
  callbackData: string,
) {
  const [, stageRaw, choiceId] = callbackData.split(":");
  const stageIndex = Number(stageRaw);

  if (stageIndex !== team.currentStageIndex) {
    await answerCallbackQuery(callbackQuery.id, "Эта карточка уже неактуальна");
    return;
  }

  const result = await selectChoice(team.id, choiceId);
  await answerCallbackQuery(callbackQuery.id);
  await sendConfirmation(chatId, result.choiceLabel);
}

async function handleBlueQ2Answer(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
  team: TeamState,
  callbackData: string,
) {
  const result = await answerBlueQ2Question(team.id, callbackData);
  await answerCallbackQuery(callbackQuery.id);

  if (result.complete) {
    await sendConfirmation(chatId, result.choiceLabel);
    return;
  }

  await sendCurrentStage(await refreshTeam(team.id));
}

async function handleChoiceConfirmation(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
  team: TeamState,
) {
  const result = await confirmChoice(team.id);
  await answerCallbackQuery(callbackQuery.id, "Решение подтверждено");

  if (result.status === "awaiting-file") {
    await sendTelegramMessage(
      chatId,
      "Решение зафиксировано. Отправьте актуальный Excel-файл бюджета в формате .xlsx, .xls или .csv.",
    );
    return;
  }

  await sendTelegramMessage(chatId, "Решение сохранено. Ждите следующий этап.");
}

async function handleDocumentMessage(
  message: TelegramMessage,
  document: TelegramDocument,
) {
  if (!message.from) {
    return;
  }

  const team = await getTeamByCaptainTelegramId(message.from.id);

  if (!team) {
    await sendTelegramMessage(
      message.chat.id,
      "Сначала нажмите /start и выберите команду, чтобы файл попал в админку.",
    );
    return;
  }

  const fileName = document.file_name ?? "budget.xlsx";

  if (!isExcelFile(fileName, document.mime_type)) {
    await sendTelegramMessage(
      message.chat.id,
      "Нужен Excel-файл: .xlsx, .xls или .csv. Пришлите файл ещё раз.",
    );
    return;
  }

  const storedFile = await uploadTelegramFileToSupabaseStorage(team, document);

  await attachFile(team.id, {
    telegramFileId: document.file_id,
    telegramFileUniqueId: document.file_unique_id ?? null,
    fileName,
    mimeType: document.mime_type ?? null,
    fileSize: document.file_size ?? null,
    storageBucket: storedFile?.bucket ?? null,
    storagePath: storedFile?.path ?? null,
  });

  await sendTelegramMessage(
    message.chat.id,
    "Файл сохранён. Этап завершён, ждите команды организатора.",
  );
}

export async function sendCurrentStage(team: TeamState) {
  if (!team.captainChatId || team.currentStageIndex < 0) {
    return;
  }

  const prompt = getBotPrompt(team);
  const sentMessage = await sendTelegramMessage(team.captainChatId, prompt.text, {
    replyMarkup: {
      inline_keyboard: prompt.choices.map((choice) => [
        {
          text: choice.label,
          callback_data:
            prompt.mode === "blue-q2-question"
              ? choice.id
              : `pick:${team.currentStageIndex}:${choice.id}`,
        },
      ]),
    },
  });

  await setDelivery(team.id, "sent");
  return sentMessage;
}

async function sendConfirmation(chatId: number, selectedLabel: string) {
  await sendTelegramMessage(
    chatId,
    `Вы выбрали: <b>${escapeHtml(selectedLabel)}</b>\n\nПодтвердить решение? После подтверждения изменить его нельзя.`,
    {
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: "Подтвердить",
              callback_data: "confirm",
            },
          ],
        ],
      },
    },
  );
}

async function refreshTeam(teamId: string) {
  const snapshot = await getSnapshot();
  const team = snapshot.teams.find((item) => item.id === teamId);

  if (!team) {
    throw new Error("Команда не найдена");
  }

  return team;
}

async function uploadTelegramFileToSupabaseStorage(
  team: TeamState,
  document: TelegramDocument,
) {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;

  if (!bucket) {
    return null;
  }

  const filePath = await getTelegramFilePath(document.file_id);

  if (!filePath) {
    return null;
  }

  const fileContent = await downloadTelegramFile(filePath);
  const extension = getFileExtension(document.file_name ?? "");
  const storagePath = `${team.id}/stage-${team.currentStageIndex}/${Date.now()}${extension || ".xlsx"}`;
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileContent, {
      contentType:
        document.mime_type ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return { bucket, path: storagePath };
}

function isExcelFile(fileName: string, mimeType?: string) {
  const extension = getFileExtension(fileName).toLowerCase();

  return (
    excelExtensions.has(extension) ||
    mimeType === "text/csv" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex) : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
