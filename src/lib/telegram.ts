export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
  from?: TelegramUser;
  document?: TelegramDocument;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from: TelegramUser;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

type SendMessageOptions = {
  replyMarkup?: {
    inline_keyboard: InlineKeyboardButton[][];
  };
};

export function getTelegramBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  return token;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: SendMessageOptions = {},
) {
  const response = await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: options.replyMarkup,
  });

  return response.result as TelegramMessage;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
) {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function getTelegramFilePath(fileId: string) {
  const response = await callTelegramApi("getFile", {
    file_id: fileId,
  });

  return response.result?.file_path as string | undefined;
}

export async function downloadTelegramFile(filePath: string) {
  const token = getTelegramBotToken();
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
  );

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`);
  }

  return response.arrayBuffer();
}

async function callTelegramApi(method: string, payload: Record<string, unknown>) {
  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram API ${method} failed`);
  }

  return data;
}
