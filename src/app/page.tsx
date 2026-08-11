import { AdminDashboard } from "@/components/admin-dashboard";
import { isAdminDashboardAllowed } from "@/lib/admin-auth";
import { getDashboardData } from "@/lib/game-data";
import { createMockSnapshot } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function Home(props: PageProps<"/">) {
  const rawSearchParams = await props.searchParams;
  const searchParams = toUrlSearchParams(rawSearchParams);
  const auth = isAdminDashboardAllowed(searchParams);

  if (!auth.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-white">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6">
          <h1 className="text-xl font-semibold">Нужен admin token</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Откройте админку с параметром <code>?token=...</code>, который
            совпадает с <code>ADMIN_DASHBOARD_TOKEN</code> в Vercel.
          </p>
        </section>
      </main>
    );
  }

  const { data, loadError } = await getSafeDashboardData();

  return (
    <AdminDashboard
      initialData={data}
      authMode={auth.mode}
      adminToken={searchParams.get("token") ?? ""}
      loadError={loadError}
    />
  );
}

async function getSafeDashboardData() {
  try {
    return { data: await getDashboardData(), loadError: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { data: createMockSnapshot(), loadError: message };
  }
}

function toUrlSearchParams(
  source: Awaited<PageProps<"/">["searchParams"]>,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
    } else if (value) {
      searchParams.set(key, value);
    }
  }

  return searchParams;
}
