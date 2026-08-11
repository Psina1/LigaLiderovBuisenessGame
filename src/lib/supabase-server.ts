import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceClient: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && getSupabaseServerKey());
}

export function getSupabaseServiceClient() {
  const serverKey = getSupabaseServerKey();

  if (!process.env.SUPABASE_URL || !serverKey) {
    throw new Error("Missing SUPABASE_URL and Supabase server key");
  }

  if (!serviceClient) {
    serviceClient = createClient(
      process.env.SUPABASE_URL,
      serverKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return serviceClient;
}

function getSupabaseServerKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  );
}
