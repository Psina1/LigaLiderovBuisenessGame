import { isAdminApiAllowed } from "@/lib/admin-auth";
import { getFileArchive } from "@/lib/game-data";

export async function GET(request: Request) {
  if (!isAdminApiAllowed(request)) {
    return Response.json({ error: "Требуется admin token" }, { status: 401 });
  }

  try {
    return Response.json({ files: await getFileArchive() });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить файлы" },
      { status: 500 },
    );
  }
}
