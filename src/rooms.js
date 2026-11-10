import { React } from "../vendor/runtime.js";
import { roomRequest } from "./room-api.js";

const h = React.createElement;

export function invitationFromLocation() {
  const params = new URLSearchParams(location.hash.slice(1));
  const room = params.get("room");
  const token = params.get("invite");
  if (!/^[a-z0-9-]{1,40}$/.test(room ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(token ?? "")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return { room, token };
}

function field(label, tag, props, children) {
  return h("label", null, label, h(tag, props, children));
}

function PasswordForm({ label, action, busy, onSubmit, focus, withEmail }) {
  function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = values.get("email")?.trim();
    const password = values.get("password");
    form.elements.password.value = "";
    onSubmit(password, email);
  }
  return h("form", { className: "editor room-password", onSubmit: submit },
    withEmail && field("Organizer email", "input", {
      name: "email", type: "email", autoComplete: "username", required: true, autoFocus: focus,
    }),
    field(label, "input", {
      name: "password", type: "password", autoComplete: "current-password",
      maxLength: withEmail ? undefined : 72, required: true, autoFocus: focus && !withEmail,
    }),
    h("button", { type: "submit", className: "primary", disabled: busy }, action),
  );
}

function RoomEditor({ room, onSave, onClose, onInvite, onDelete, busy, inviteUrl, notice }) {
  const [visibility, setVisibility] = React.useState(room?.visibility ?? "public");
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [inviteUrl]);

  function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({
      name: data.get("name").trim(),
      visibility,
      password: data.get("password") || undefined,
      removePassword: data.has("removePassword"),
      revision: room?.revision,
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return h("section", { className: "room-lobby-card" },
    h("h2", null, room ? "Room settings" : "Create a room"),
    h("form", { className: "editor room-settings", onSubmit: submit },
      field("Room name", "input", { name: "name", defaultValue: room?.name, maxLength: 40, required: true, autoFocus: true }),
      field("Room access", "select", { value: visibility, onChange: (event) => setVisibility(event.target.value) }, [
        h("option", { value: "public", key: "public" }, "Public"),
        h("option", { value: "private", key: "private" }, "Private"),
      ]),
      visibility === "private" && h(React.Fragment, null,
        field(room?.hasPassword ? "New room password (optional)" : "Room password (optional)", "input", {
          name: "password", type: "password", autoComplete: "new-password", minLength: 8, maxLength: 72,
        }),
        room?.hasPassword && h("label", { className: "room-checkbox" },
          h("input", { name: "removePassword", type: "checkbox" }), "Remove the current room password",
        ),
        h("p", { className: "note" }, "An invite link also grants entry. Leave the password blank when creating a room to use invite links only."),
        room?.visibility === "public" && h("p", { className: "note" }, "Replace any table links that visitors could already have copied."),
      ),
      h("div", { className: "room-actions" },
        h("button", { type: "submit", className: "primary", disabled: busy }, room ? "Save room settings" : "Create room"),
        h("button", { type: "button", onClick: onClose, disabled: busy }, "Done"),
      ),
    ),
    room?.visibility === "private" && visibility === "private" && h("div", { className: "room-invite" },
      h("h3", null, "Invite link"),
      h("p", { className: "note" }, "Anyone with the link can enter for 24 hours. Generating a new link replaces the previous one."),
      h("div", { className: "room-actions" },
        h("button", { type: "button", disabled: busy, onClick: () => onInvite(false) }, "Generate invite link"),
        room.inviteExpires && h("button", { type: "button", disabled: busy, onClick: () => onInvite(true) }, "Revoke invite link"),
      ),
      inviteUrl && h("div", { className: "room-actions room-invite-link" },
        field("Share this URL", "input", { value: inviteUrl, readOnly: true, onFocus: (event) => event.target.select() }),
        h("button", { type: "button", onClick: copy }, copied ? "Copied" : "Copy link"),
      ),
    ),
    room && h("button", { type: "button", disabled: busy, onClick: () => {
      if (window.confirm(`Delete "${room.name}"? This permanently removes its tables and schedules, invalidates its invite links, and returns visitors to the lobby.`)) onDelete();
    } }, "Delete room"),
    notice && h("p", { className: "note", role: "status" }, notice),
  );
}

export function RoomExperience({ invitation, renderRoom }) {
  const [lobby, setLobby] = React.useState({ rooms: [], admin: false });
  const [current, setCurrent] = React.useState(null);
  const [editorId, setEditorId] = React.useState(null);
  const [lockedId, setLockedId] = React.useState(null);
  const [showLogin, setShowLogin] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [inviteUrl, setInviteUrl] = React.useState("");
  const [notice, setNotice] = React.useState("");

  async function refresh() {
    const next = await roomRequest("/state");
    setLobby(next);
    return next;
  }

  async function act(operation) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function enter(roomId, credential = {}) {
    const snapshot = await roomRequest(`/rooms/${roomId}/enter`, credential);
    setLockedId(null);
    setCurrent(snapshot);
  }

  React.useEffect(() => {
    void act(async () => {
      await refresh();
      if (invitation) {
        try {
          await enter(invitation.room, { invite: invitation.token });
        } catch (failure) {
          setLockedId(invitation.room);
          throw failure;
        }
      }
    });
  }, []);

  function selectRoom(room) {
    setError("");
    if (room.canEnter) void act(() => enter(room.id));
    else setLockedId(room.id);
  }

  function editRoom(id) {
    setEditorId(id);
    setError("");
    setInviteUrl("");
    setNotice("");
  }

  function exitRoom(message = "") {
    setCurrent(null);
    setError(message);
    void refresh().catch((failure) => setError(failure.message));
  }

  if (current) return renderRoom(current, exitRoom);

  const editedRoom = lobby.rooms.find((room) => room.id === editorId);
  const lockedRoom = lobby.rooms.find((room) => room.id === lockedId);
  return h("main", { className: "commons" },
    h("div", { className: "commons-shell room-lobby" },
      h("header", { className: "studio-header" }, h("h1", null, "Cherry Commons")),
      h("section", { className: "room-lobby-card", "aria-label": "Room selector" },
        h("div", { className: "room-lobby-heading" },
          h("div", null, h("h2", null, "Choose a room"), h("p", { className: "note" }, "Each room has its own floor and meeting tables.")),
          h("div", { className: "room-actions" },
            lobby.admin
              ? h(React.Fragment, null,
                  h("button", { type: "button", disabled: busy, onClick: () => editRoom("new") }, "Create a room"),
                  h("button", { type: "button", disabled: busy, onClick: () => act(async () => {
                    await roomRequest("/admin/logout", {});
                    editRoom(null);
                    await refresh();
                  }) }, "Admin sign out"),
                )
              : h("button", { type: "button", disabled: busy, onClick: () => setShowLogin(!showLogin) }, showLogin ? "Cancel admin sign-in" : "Admin sign in"),
            h("button", { type: "button", disabled: busy, onClick: () => act(refresh) }, "Refresh"),
          ),
        ),
        showLogin && !lobby.admin && h(PasswordForm, {
          label: "Organizer password", action: "Sign in", busy, focus: true, withEmail: true,
          onSubmit: (password, email) => act(async () => {
            await roomRequest("/admin/login", { email, password });
            await refresh();
            setShowLogin(false);
          }),
        }),
        h("div", { className: "room-grid" }, lobby.rooms.map((room) => h("article", {
          className: `room-tile room-tile-${room.visibility}`, key: room.id,
        },
          h("span", { className: "room-badge" }, room.visibility === "public" ? "Public" : "Private"),
          h("h3", null, room.name),
          h("div", { className: "room-actions" },
            h("button", { type: "button", className: "primary", disabled: busy, onClick: () => selectRoom(room) },
              room.canEnter ? "Enter room" : "Unlock room",
            ),
            lobby.admin && h("button", { type: "button", disabled: busy, onClick: () => editRoom(room.id) }, "Room settings"),
          ),
        ))),
        lockedRoom && h("div", { className: "room-unlock" },
          h("h3", null, `Unlock ${lockedRoom.name}`),
          lockedRoom.hasPassword
            ? h(PasswordForm, {
                key: lockedRoom.id, label: "Room password", action: "Unlock and enter", busy, focus: true,
                onSubmit: (password) => act(() => enter(lockedRoom.id, { password })),
              })
            : h("p", { className: "note" }, "Open a valid invitation link from the room admin to enter."),
        ),
        error && h("p", { className: "note bad", role: "alert" }, error),
      ),
      lobby.admin && (editedRoom || editorId === "new") && h(RoomEditor, {
        key: `${editorId}:${editedRoom?.revision ?? 0}`, room: editedRoom, busy, inviteUrl, notice,
        onClose: () => editRoom(null),
        onSave: (values) => act(async () => {
          const { room } = await roomRequest(editedRoom ? `/rooms/${editedRoom.id}/settings` : "/rooms", values);
          await refresh();
          editRoom(room.id);
          setNotice("Room settings saved.");
        }),
        onDelete: () => act(async () => {
          await roomRequest(`/rooms/${editedRoom.id}/delete`, { revision: editedRoom.revision });
          setLobby((previous) => ({ ...previous, rooms: previous.rooms.filter((room) => room.id !== editedRoom.id) }));
          setLockedId(null);
          editRoom(null);
          await refresh();
        }),
        onInvite: (revoke) => act(async () => {
          const { token } = await roomRequest(`/rooms/${editedRoom.id}/invite`, { revoke });
          const url = new URL(location.pathname, location.origin);
          if (token) url.hash = new URLSearchParams({ room: editedRoom.id, invite: token });
          setInviteUrl(token ? url.href : "");
          setNotice(revoke ? "Invite link revoked." : "New invite link ready.");
          await refresh();
        }),
      }),
    ),
  );
}
