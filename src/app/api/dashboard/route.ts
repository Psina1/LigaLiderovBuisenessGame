import { isAdminApiAllowed } from "@/lib/admin-auth";
import { getDashboardData } from "@/lib/game-data";
import { createMockSnapshot } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminApiAllowed(request)) {
    return Response.json({ error: "Требуется admin token" }, { status: 401 });
  }

  try {
    return Response.json(await getDashboardData(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return Response.json({
      ...createMockSnapshot(),
      source: "mock",
      loadError: message,
    });
  }
}
