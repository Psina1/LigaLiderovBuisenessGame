import { isAdminApiAllowed } from "@/lib/admin-auth";
import { getSupabaseServiceClient } from "@/lib/supabase-server";
import { downloadTelegramFile, getTelegramFilePath } from "@/lib/telegram";

type UploadedFileRow = {
  file_name: string;
  mime_type: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  telegram_file_id: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  if (!isAdminApiAllowed(request)) {
    return Response.json({ error: "Требуется admin token" }, { status: 401 });
  }

  const { fileId } = await context.params;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("file_name,mime_type,storage_bucket,storage_path,telegram_file_id")
    .eq("id", fileId)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Файл не найден" }, { status: 404 });
  }

  const file = data as UploadedFileRow;
  const fileContent = await loadFile(file, supabase);

  if (!fileContent) {
    return Response.json({ error: "Файл пока доступен только в Telegram" }, { status: 404 });
  }

  return new Response(fileContent, {
    headers: {
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      "content-type":
        file.mime_type ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}

async function loadFile(
  file: UploadedFileRow,
  supabase: ReturnType<typeof getSupabaseServiceClient>,
) {
  if (file.storage_bucket && file.storage_path) {
    const { data, error } = await supabase.storage
      .from(file.storage_bucket)
      .download(file.storage_path);

    if (error) {
      throw error;
    }

    return data;
  }

  const telegramFilePath = await getTelegramFilePath(file.telegram_file_id);

  if (!telegramFilePath) {
    return null;
  }

  return downloadTelegramFile(telegramFilePath);
}
