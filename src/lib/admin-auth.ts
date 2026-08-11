export function isAdminDashboardAllowed(searchParams: URLSearchParams) {
  const expectedToken = process.env.ADMIN_DASHBOARD_TOKEN;

  if (!expectedToken) {
    return { allowed: true, mode: "open" as const };
  }

  return {
    allowed: searchParams.get("token") === expectedToken,
    mode: "token" as const,
  };
}

export function isAdminApiAllowed(request: Request) {
  const expectedToken = process.env.ADMIN_DASHBOARD_TOKEN;

  if (!expectedToken) {
    return true;
  }

  const url = new URL(request.url);
  const token =
    request.headers.get("x-admin-token") ??
    url.searchParams.get("token") ??
    "";

  return token === expectedToken;
}
