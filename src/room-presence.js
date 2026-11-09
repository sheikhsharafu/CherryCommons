import { React } from "../vendor/runtime.js";
import { createRoomToken, roomPresence } from "./room-api.js";

const HEARTBEAT_MS = 4_000;
const EMPTY_COUNTS = Object.freeze(Object.create(null));

export function useRoomPresence(roomId, displayName, onSeatReset, onAccessLost) {
  const [client] = React.useState(createRoomToken);
  const [presence, setPresence] = React.useState(null);
  const [presenceError, setPresenceError] = React.useState("");
  const active = React.useRef(false);
  const seat = React.useRef(null);
  const queue = React.useRef(Promise.resolve());
  const accessLost = React.useRef(onAccessLost);
  accessLost.current = onAccessLost;

  const send = React.useCallback((action, table, isCurrent) => {
    const request = queue.current.then(async () => {
      if (action !== "leave" && (!active.current || isCurrent?.() === false)) return "cancelled";
      try {
        let next = await roomPresence(roomId, client, displayName, action, table);
        if (action === "leave" || !active.current) return "cancelled";
        let result = next.result;
        if (action === "claim" && result === "joined") {
          if (isCurrent()) {
            seat.current = next.tableId;
          } else {
            // Release an invalidated claim before sending the next queued action.
            next = await roomPresence(roomId, client, displayName, "release");
            result = "cancelled";
          }
        }
        if (action === "heartbeat" && next.tableId && !seat.current && active.current) {
          // A timed-out claim can have reached Supabase even if its reply was lost.
          next = await roomPresence(roomId, client, displayName, "release");
        }
        if (!active.current) return "cancelled";
        if (seat.current && next.tableId !== seat.current) {
          seat.current = null;
          onSeatReset(true);
        }
        setPresence({ ...next, counts: Object.assign(Object.create(null), next.counts) });
        setPresenceError("");
        return result;
      } catch (error) {
        if (action !== "leave" && active.current) {
          if (error.status === 403 || error.status === 404) accessLost.current(error.message);
          else setPresenceError(error.message);
        }
        return "unavailable";
      }
    });
    queue.current = request;
    return request;
  }, [roomId, client, displayName, onSeatReset]);

  const releaseSeat = React.useCallback(() => {
    if (!seat.current) return;
    seat.current = null;
    void send("release");
  }, [send]);

  React.useEffect(() => {
    let pendingHeartbeat = false;
    function heartbeat() {
      if (!active.current || pendingHeartbeat) return;
      pendingHeartbeat = true;
      void send("heartbeat").finally(() => { pendingHeartbeat = false; });
    }
    function join() {
      active.current = true;
      heartbeat();
    }
    function leave(pageIsClosing = false) {
      if (!active.current) return;
      active.current = false;
      seat.current = null;
      if (pageIsClosing) {
        void roomPresence(roomId, client, displayName, "leave").catch(() => {});
      } else {
        void send("leave");
      }
    }
    function pageHide() {
      leave(true);
      onSeatReset(false);
    }

    join();
    const timer = setInterval(heartbeat, HEARTBEAT_MS);
    window.addEventListener("focus", heartbeat);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", join);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", heartbeat);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", join);
      leave();
    };
  }, [roomId, client, displayName, onSeatReset, send]);

  return {
    counts: presence?.counts ?? EMPTY_COUNTS,
    visitors: presence?.visitors ?? null,
    presenceError,
    reserveSeat: (table, isCurrent) => send("claim", table, isCurrent),
    releaseSeat,
  };
}
