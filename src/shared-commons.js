import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

let client;
export function getSharedClient() {
  if (!client) {
    if (!globalThis.supabase?.createClient) throw new Error("The Supabase SDK could not load. Check the vendor folder.");
    client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export async function signInOrganizer(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return "Could not sign in with those credentials.";

  const { data: organizer, error: accessError } = await client.from("cc_organizers")
    .select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (accessError || !organizer) {
    await client.auth.signOut({ scope: "local" });
    return "This account does not have organizer access.";
  }
  return "";
}
