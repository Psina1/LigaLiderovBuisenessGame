import {
  answerBlueQ2Question,
  attachFile,
  autoAssignCaptain,
  confirmChoice,
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
    await registerCaptain(message, parseStartPayload(message.text));
    return { ok: true };
  }

  if (message.document) {
    await handleDocumentMessage(message, message.document);
    return { ok: true };
  }

  await sendTelegramMessage(
    message.chat.id,
    "Нажмите /start, чтобы автоматически занять свободную команду, и дальше отвечайте на задания кнопками.",
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
    await answerCallbackQuery(callbackQuery.id);
    await registerCaptainFromCallback(callbackQuery, chatId);
    return { ok: true };
  }

  const team = await getTeamByCaptainTelegramId(callbackQuery.from.id);

  if (!team) {
    await answerCallbackQuery(callbackQuery.id, "Сначала подключитесь к команде");
    await sendTelegramMessage(chatId, "Нажмите /start, чтобы автоматически занять свободную команду.");
    return { ok: true };
  }

  if (data.startsWith("blueq2:")) {
    await handleCallbackAction(callbackQuery, chatId, () =>
      handleBlueQ2Answer(chatId, team, data),
    );
    return { ok: true };
  }

  if (data.startsWith("pick:")) {
    await handleCallbackAction(callbackQuery, chatId, () =>
      handleChoice(chatId, team, data),
    );
    return { ok: true };
  }

  if (data === "confirm") {
    await handleCallbackAction(callbackQuery, chatId, () =>
      handleChoiceConfirmation(chatId, team),
    );
    return { ok: true };
  }

  await answerCallbackQuery(callbackQuery.id, "Неизвестная команда");
  return { ok: true };
}

async function handleCallbackAction(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
  action: () => Promise<void>,
) {
  try {
    await answerCallbackQuery(callbackQuery.id);
    await action();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Не удалось обработать кнопку. Напишите организатору.";

    await sendTelegramMessage(
      chatId,
      `${escapeHtml(message)}\n\nЕсли этап уже закрыт организатором, ждите следующего сообщения от бота.`,
    );
  }
}

function parseStartPayload(text: string) {
  const payload = text.split(/\s+/)[1]?.trim();
  return payload?.startsWith("team-") ? payload : undefined;
}

function registrationErrorText(status: string) {
  if (status === "registration_closed") {
    return "Игра уже началась. Чтобы заменить капитана, попросите организатора освободить нужную команду и дать код вида /start team-7.";
  }

  if (status === "missing") {
    return "Такой команды нет. Проверьте код или напишите организатору.";
  }

  return "Свободных команд нет. Напишите организатору.";
}

async function registerCaptain(message: TelegramMessage, requestedTeamId?: string) {
  if (!message.from) {
    return;
  }

  const result = await autoAssignCaptain(
    {
      telegramId: message.from.id,
      chatId: message.chat.id,
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
    },
    requestedTeamId,
  );

  await respondToRegistrationResult(message.chat.id, result);
}

async function registerCaptainFromCallback(
  callbackQuery: TelegramCallbackQuery,
  chatId: number,
) {
  const result = await autoAssignCaptain({
    telegramId: callbackQuery.from.id,
    chatId,
    username: callbackQuery.from.username,
    firstName: callbackQuery.from.first_name,
    lastName: callbackQuery.from.last_name,
  });

  await respondToRegistrationResult(chatId, result);
}

async function respondToRegistrationResult(
  chatId: number,
  result: Awaited<ReturnType<typeof autoAssignCaptain>>,
) {
  if (result.status === "full" || !result.team) {
    await sendTelegramMessage(chatId, registrationErrorText(result.status));
    return;
  }

  if (result.status === "already_taken") {
    await sendTelegramMessage(
      chatId,
      `${result.team.name} уже занята другим капитаном. Если это ошибка, попросите организатора освободить слот.`,
    );
    return;
  }

  if (result.status === "already_registered") {
    await sendTelegramMessage(
      chatId,
      `Вы уже привязаны к ${result.team.name}. Один капитан может вести только одну команду.`,
    );

    if (result.team.currentStageIndex >= 0 && result.team.currentStageIndex < scenarioLength) {
      await sendCurrentStage(result.team);
    }

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
  chatId: number,
  team: TeamState,
  callbackData: string,
) {
  const [, stageRaw, choiceId] = callbackData.split(":");
  const stageIndex = Number(stageRaw);

  if (stageIndex !== team.currentStageIndex) {
    await sendTelegramMessage(chatId, "Эта карточка уже неактуальна. Ждите актуальное сообщение от бота.");
    return;
  }

  const result = await selectChoice(team.id, choiceId);
  await sendConfirmation(chatId, result.choiceLabel);
}

async function handleBlueQ2Answer(
  chatId: number,
  team: TeamState,
  callbackData: string,
) {
  const result = await answerBlueQ2Question(team.id, callbackData);

  if (result.complete) {
    await sendConfirmation(chatId, result.choiceLabel);
    return;
  }

  await sendCurrentStage(await refreshTeam(team.id));
}

async function handleChoiceConfirmation(
  chatId: number,
  team: TeamState,
) {
  const result = await confirmChoice(team.id);

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
      "Сначала нажмите /start, чтобы занять свободную команду, и файл попадёт в админку.",
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
