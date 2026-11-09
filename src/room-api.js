import { getSharedClient, signInOrganizer } from "./shared-commons.js";

let guestToken;
function guestSession() {
  if (guestToken) return guestToken;
  const path = new URL(".", location.href).pathname;
  const key = "cherry-commons.room-session:" + path;
  try { guestToken = sessionStorage.getItem(key); } catch {}
  if (!/^[0-9a-f]{64}$/.test(guestToken ?? "")) {
    guestToken = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    try { sessionStorage.setItem(key, guestToken); } catch {}
  }
  return guestToken;
}

export async function roomRequest(path, body = {}) {
  const client = getSharedClient();
  if (path === "/admin/login") {
    const error = await signInOrganizer(client, body.email, body.password);
    if (error) throw new Error(error);
    return;
  }
  if (path === "/admin/logout") {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Could not sign out. Try again.");
    return;
  }

  let action, room;
  if (path === "/state") action = "lobby";
  else if (path === "/rooms") action = "create";
  else {
    const match = /^\/rooms\/([a-z0-9-]{1,40})(?:\/(enter|settings|invite|tables))?$/.exec(path);
    if (!match) throw new Error("Unknown room request.");
    room = match[1];
    action = match[2] ?? "read";
  }

  const { data, error } = await client.rpc("cc_room_request", {
    p_action: action, p_room: room ?? null, p_session: guestSession(), p_payload: body,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error("Room setup is missing in Supabase. Run supabase-pages-rooms.sql in the project SQL Editor.");
    }
    throw new Error("Could not reach the Supabase room service. Check the project configuration and try again.");
  }
  if (data?.error) {
    const failure = new Error(data.error);
    failure.status = data.status;
    throw failure;
  }
  if (!data) throw new Error("The Supabase room service returned an empty response.");
  return data;
}
