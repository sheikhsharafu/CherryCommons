import { getSharedClient, signInOrganizer } from "./shared-commons.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

export function createRoomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let guestToken;
function guestSession() {
  if (guestToken) return guestToken;
  const path = new URL(".", location.href).pathname;
  const key = "cherry-commons.room-session:" + path;
  try { guestToken = sessionStorage.getItem(key); } catch {}
  if (!/^[0-9a-f]{64}$/.test(guestToken ?? "")) {
    guestToken = createRoomToken();
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
    const match = /^\/rooms\/([a-z0-9-]{1,40})(?:\/(enter|settings|invite|tables|delete))?$/.exec(path);
    if (!match) throw new Error("Unknown room request.");
    room = match[1];
    action = match[2] ?? "read";
  }

  const response = await client.rpc("cc_room_request", {
    p_action: action, p_room: room ?? null, p_session: guestSession(), p_payload: body,
  });
  return roomResponse(response, "supabase-pages-rooms.sql", "room service");
}

export async function roomPresence(room, client, name, action, table = null) {
  const body = {
    p_action: action, p_room: room, p_session: guestSession(),
    p_client: client, p_name: name, p_table: table,
  };
  if (action === "leave") {
    // Cleanup uses the visitor tokens, so it can outlive the page without an auth lookup.
    await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/cc_room_presence`, {
      method: "POST", keepalive: true,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return;
  }
  const request = getSharedClient().rpc("cc_room_presence", body);
  const response = await (typeof globalThis.AbortSignal?.timeout === "function"
    ? request.abortSignal(AbortSignal.timeout(8_000))
    : request);
  return roomResponse(response, "supabase-pages-presence.sql", "room presence service");
}

function roomResponse({ data, error }, migration, service) {
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(`Room setup is missing in Supabase. Run ${migration} in the project SQL Editor.`);
    }
    throw new Error(`Could not reach the Supabase ${service}. Check the project configuration and try again.`);
  }
  if (data?.error) {
    const failure = new Error(data.error);
    failure.status = data.status;
    throw failure;
  }
  if (!data) throw new Error(`The Supabase ${service} returned an empty response.`);
  return data;
}
