import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

export const sharedEnabled = SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

let clientPromise;
export function getSharedClient() {
  clientPromise ??= import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    }))
    .catch((error) => {
      clientPromise = null;
      throw error;
    });
  return clientPromise;
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

export async function readDirectory(client) {
  const { data, error } = await client.from("cc_directory")
    .select("config,revision").eq("id", 1).single();
  if (error) throw error;
  return data;
}

export async function saveDirectory(client, config, revision) {
  const { data, error } = await client.from("cc_directory")
    .update({ config, revision: revision + 1 })
    .eq("id", 1).eq("revision", revision)
    .select("config,revision").maybeSingle();
  if (error) throw error;
  return data;
}

export function countPresence(state) {
  const counts = Object.create(null);
  let online = 0;
  for (const sessions of Object.values(state)) {
    for (const session of sessions) {
      online++;
      if (typeof session.tableId === "string" && session.tableId) {
        counts[session.tableId] = (counts[session.tableId] ?? 0) + 1;
      }
    }
  }
  return { online, counts };
}
