import { React, jsxRuntime, createRoot, Phaser } from "../vendor/runtime.js";
import { MEETING_FILE_TYPES, readMeetingFile } from "./meeting-import.js";
import { RoomExperience, invitationFromLocation } from "./rooms.js";
import { roomRequest } from "./room-api.js";

      function bootCherryCommons() {
        /* Map appearance and drawing helpers */
        const INK_COLOR = "#22303A";
        const PROVIDER_LABELS = {
          zoom: "Zoom",
          webex: "Webex",
          meet: "Google Meet",
          teams: "Teams",
        };
        const MAP_FONT = '"Bricolage Grotesque Variable", system-ui, sans-serif';
        const colorToNumber = (g) => parseInt(g.slice(1), 16);
        const INITIAL_WORLD = { w: 1280, h: 720 };
        const TABLE_PALETTES = [
          { mat: 0xe9def9, accent: 0x77588f },
          { mat: 0xf9d8de, accent: 0x9c4f66 },
          { mat: 0xfbefbc, accent: 0x895c2f },
          { mat: 0xd9ebd2, accent: 0x487451 },
        ];
        const tableNumber = (index) => String(index + 1).padStart(2, "0");
        const MAP_MARGIN = 20;
        const SPAWN = { x: 640, y: 64 };
        const WALK_SPEED = 340;
        const WALK_POSE_LIMIT = 6;
        const INK_NUMBER = colorToNumber(INK_COLOR);
        const addMapText = (scene, x, y, text, size, weight, color, alpha = 1) =>
          scene.add
            .text(x, y, text, {
              fontFamily: MAP_FONT,
              fontSize: `${size}px`,
              fontStyle: String(weight),
              color: color,
            })
            .setAlpha(alpha);
        function fitText(text, maxWidth) {
          let value = text.text;
          for (; value.length > 1 && text.width > maxWidth;) {
            ((value = value.slice(0, -1)), text.setText(`${value.trimEnd()}…`));
          }
          return text;
        }
        /* Table floor and avatar movement */
        class CommonsScene extends Phaser.Scene {
          constructor() {
            super("world");
            this.tableViews = new Map();
            this.currentTableId = null;
          }
          init({ bridge, tables, page }) {
            this.bridge = bridge;
            this.pendingPage = page;
            this.pendingTables = tables;
          }
          create() {
            this.drawTableFloor();
            this.tableLayer = this.add.container(0, 0).setDepth(1);
            this.furniture = this.physics.add.staticGroup();
            const { me: profile } = this.bridge;
            this.player = this.makeAvatar(SPAWN.x, SPAWN.y, profile.color, profile.name, profile.appearance);
            this.player.body.body.setCollideWorldBounds(true);
            this.physics.add.collider(this.player.body, this.furniture);
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasd = this.input.keyboard.addKeys("W,A,S,D");
            this.setPage(this.pendingPage, this.pendingTables);
            this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncPlayer, this);
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
              this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncPlayer, this);
              this.tableViews.clear();
            });
          }
          drawTableFloor() {
            const { w: width, h: height } = INITIAL_WORLD;
            const floorKey = "commons-floor";
            this.cameras.main.setBackgroundColor("#b7d7a7");
            if (!this.textures.exists(floorKey)) {
              const floor = this.add.graphics();
              floor.fillStyle(0xe5efd6).fillRoundedRect(8, 8, width - 16, height - 16, 22);
              floor.fillStyle(0x9bb68f, 0.45);
              for (let x = 26; x < width - 20; x += 20) {
                for (let y = 26; y < height - 20; y += 20) floor.fillCircle(x, y, 1.15);
              }
              floor.lineStyle(3, 0x7c9879).strokeRoundedRect(8, 8, width - 16, height - 16, 22);
              floor.generateTexture(floorKey, width, height);
              floor.destroy();
            }
            this.add.image(0, 0, floorKey).setOrigin(0);
            this.floorTitle = addMapText(this, 30, 33, this.bridge.roomName().toUpperCase(), 17, 800, "#43593e");
            fitText(this.floorTitle, 490);
            this.physics.world.setBounds(MAP_MARGIN, MAP_MARGIN, width - MAP_MARGIN * 2, height - MAP_MARGIN * 2);
          }
          makeAvatar(x, y, color, name, appearance = { ...DEFAULT_APPEARANCE, shirt: "#" + color.toString(16).padStart(6, "0") }) {
            const body = this.add.circle(x, y, 13).setVisible(false);
            this.physics.add.existing(body);
            body.body.setCircle(13);
            const texture = this.getAvatarTexture(appearance);
            const portrait = this.add.image(x, y, texture, "0").setOrigin(0.5, 0.6).setDepth(10);
            const label = this.add.text(x, y - 46, name, {
              fontFamily: MAP_FONT,
              fontSize: "14px",
              fontStyle: "600",
              color: INK_COLOR,
              backgroundColor: "#FFFFFFEE",
              padding: { x: 6, y: 2 },
            }).setOrigin(0.5).setDepth(11);
            const shadow = this.add.ellipse(x, y + 12, 34, 10, INK_NUMBER, 0.22).setDepth(9);
            return { body, portrait, label, shadow, stride: 0, step: 0, pose: 0 };
          }
          getAvatarTexture(appearance) {
            const key = `avatar:${JSON.stringify(appearance)}`;
            if (this.textures.exists(key)) return key;

            // Bake all poses into one texture so walking only switches the displayed frame.
            const frameWidth = 64;
            const frameHeight = 80;
            const sheet = this.add.graphics();
            for (let pose = -WALK_POSE_LIMIT; pose <= WALK_POSE_LIMIT; pose++) {
              const x = (pose + WALK_POSE_LIMIT + 0.5) * frameWidth;
              sheet.save().translateCanvas(x, frameHeight * 0.6);
              this.paintAvatar(sheet, appearance, pose / 2);
              sheet.restore();
            }
            sheet.generateTexture(key, frameWidth * (WALK_POSE_LIMIT * 2 + 1), frameHeight);
            sheet.destroy();
            const texture = this.textures.get(key);
            for (let pose = -WALK_POSE_LIMIT; pose <= WALK_POSE_LIMIT; pose++) {
              texture.add(String(pose), 0, (pose + WALK_POSE_LIMIT) * frameWidth, 0, frameWidth, frameHeight);
            }
            return key;
          }
          paintAvatar(portrait, appearance, step) {
            for (const part of avatarParts(appearance, step)) {
              portrait.fillStyle(colorToNumber(part.color));
              if (part.type === "ellipse") {
                portrait.fillEllipse(part.x, part.y, part.width, part.height);
              } else if (part.type === "polygon") {
                portrait.fillPoints(part.points, true);
              } else {
                portrait.fillRoundedRect(part.x, part.y, part.width, part.height, part.radius);
              }
            }
          }
          setPage(page, tables) {
            if (!this.tableLayer) {
              this.pendingPage = page;
              this.pendingTables = tables;
              return;
            }
            if (this.page !== page) {
              this.leaveTable(false);
              this.skippedTableId = null;
              this.player.body.body.reset(SPAWN.x, SPAWN.y);
              this.input.keyboard.resetKeys();
            }
            this.page = page;
            this.tables = tables;
            if (this.pendingTable && !tables.some((table) => table.id === this.pendingTable.id && table.sched.open)) {
              this.pendingTable = null;
            }
            if (this.currentTableId && !tables.some((table) => table.id === this.currentTableId && table.sched.open)) {
              this.leaveTable();
            }
            // Tabletops only change when the table layout does, not on every status refresh.
            const layoutKey = tables.map((table) => `${table.x},${table.y},${table.w}`).join("|");
            if (layoutKey !== this.layoutKey) {
              this.layoutKey = layoutKey;
              this.furniture.clear(true, true);
              for (const table of tables) {
                this.furniture.add(this.add.rectangle(table.x + table.w / 2, table.y + 34, 154, 36));
              }
            }
            this.renderTables();
          }
          setCounts(counts) {
            this.counts = counts;
            if (this.tableLayer) this.renderTables();
          }
          renderTables() {
            const visible = new Set();
            for (const table of this.tables) {
              visible.add(table.id);
              const count = this.counts?.[table.id] ?? 0;
              const status = describeTableStatus(table, count);
              const signature = JSON.stringify([
                table.index, table.x, table.y, table.w, table.h, table.name, table.host, table.caption,
                table.capacity, table.sched.open, table.id === this.currentTableId, count, status,
              ]);
              const previous = this.tableViews.get(table.id);
              if (previous?.signature === signature) continue;
              previous?.layer.destroy();
              const layer = this.add.container(0, 0);
              this.tableLayer.add(layer);
              this.drawTable(layer, table, count, status);
              this.tableViews.set(table.id, { layer, signature });
            }
            for (const [id, view] of this.tableViews) {
              if (visible.has(id)) continue;
              view.layer.destroy();
              this.tableViews.delete(id);
            }
          }
          drawTable(layer, table, count, status) {
            const { x, y, w, h } = table;
            const center = x + w / 2;
            const closed = !table.sched.open;
            const active = !closed && table.id === this.currentTableId;
            const palette = TABLE_PALETTES[table.index % TABLE_PALETTES.length];
            const accent = closed ? 0x686860 : palette.accent;
            const art = this.add.graphics();
            art.fillStyle(closed ? 0xe8e4dd : palette.mat).fillRoundedRect(x, y, w, h, 14);
            art.lineStyle(active ? 4 : 2, accent, active ? 1 : 0.55).strokeRoundedRect(x, y, w, h, 14);
            // The tabletop blocks walking. The mat and chair area trigger the meeting.
            art.fillStyle(0x644d39, 0.25).fillRoundedRect(center - 75, y + 21, 154, 36, 7);
            art.fillStyle(closed ? 0xb8c0ba : 0xe3bb8a).fillRoundedRect(center - 77, y + 16, 154, 36, 7);
            art.lineStyle(2, 0x846449, 0.7).strokeRoundedRect(center - 77, y + 16, 154, 36, 7);
            art.fillStyle(0x27363b).fillRoundedRect(center - 20, y + 20, 40, 22, 4);
            art.fillStyle(accent).fillRoundedRect(center - 16, y + 23, 32, 14, 2);
            art.fillStyle(accent, 0.75).fillRoundedRect(center - 17, y + 59, 34, 30, 9);
            art.lineStyle(2, INK_NUMBER, 0.35).strokeRoundedRect(center - 17, y + 59, 34, 30, 9);
            layer.add(art);
            const addLabel = (text, labelY, size, weight, color, maxWidth = w + 30) => {
              const label = addMapText(this, center, labelY, text, size, weight, color);
              layer.add(fitText(label, maxWidth).setOrigin(0.5));
            };
            const full = !closed && count >= table.capacity;
            art.fillStyle(full ? 0xa22936 : count ? 0x1c6961 : 0x405952)
              .fillRoundedRect(x + w - 79, y + 62, 68, 24, 10);
            const badge = addMapText(this, x + w - 45, y + 74, `${count}/${table.capacity}`, 15, 700, "#ffffff");
            layer.add(fitText(badge, 60).setOrigin(0.5));
            art.fillStyle(0xfffaf0).fillRoundedRect(x + 11, y + 62, 34, 24, 8);
            const number = addMapText(this, x + 28, y + 74, tableNumber(table.index), 14, 800, INK_COLOR);
            layer.add(number.setOrigin(0.5));
            addLabel(table.name, y - 14, 18, 700, INK_COLOR);
            if (table.host) addLabel(table.host, y + 5, 13, 500, "#53655c");
            addLabel(status, y + h - 12, 14, 600, INK_COLOR, w - 14);
            if (table.caption) addLabel(table.caption, y + h + 12, 13, 500, "#53655c");
          }
          tableAt(x, y) {
            return this.tables.find((table) =>
              table.sched.open && x >= table.x && x <= table.x + table.w &&
              y >= table.y && y <= table.y + table.h,
            );
          }
          setAvatarVisible(visible) {
            const { portrait, label, shadow } = this.player;
            for (const part of [portrait, label, shadow]) part.setVisible(visible);
          }
          leaveTable(moveToAisle = true) {
            this.pendingTable = null;
            if (!this.currentTableId) return;
            const id = this.currentTableId;
            const table = this.tables.find((item) => item.id === id);
            this.currentTableId = null;
            this.skippedTableId = moveToAisle ? id : null;
            if (moveToAisle && table) {
              this.player.body.body.reset(table.x + table.w / 2, table.y + table.h + 20);
            }
            this.setAvatarVisible(true);
            this.bridge.onExitTable(id);
            this.renderTables();
          }
          update(time, delta) {
            if (!this.player) return;
            const body = this.player.body.body;
            const seated = this.currentTableId || this.pendingTable;
            const editingInput =
              document.activeElement &&
              ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
            let moveX = 0;
            let moveY = 0;
            seated || editingInput ||
              (this.cursors.left.isDown || this.wasd.A.isDown
                ? (moveX = -1)
                : (this.cursors.right.isDown || this.wasd.D.isDown) && (moveX = 1),
              this.cursors.up.isDown || this.wasd.W.isDown
                ? (moveY = -1)
                : (this.cursors.down.isDown || this.wasd.S.isDown) && (moveY = 1));
            const length = Math.hypot(moveX, moveY) || 1;
            body.setVelocity((moveX / length) * WALK_SPEED, (moveY / length) * WALK_SPEED);
            // Follow the display refresh rate and cap long steps after a stalled frame.
            this.physics.world.update(time, Math.min(delta, 50));
          }
          syncPlayer(_time, delta) {
            if (this.currentTableId || this.pendingTable) return;
            const player = this.player;
            const { x, y, body } = player.body;
            const distance = Math.hypot(body.deltaXFinal(), body.deltaYFinal());
            if (distance > 0.05) {
              player.stride = (player.stride + distance / 20) % (2 * Math.PI);
              player.step = Math.sin(player.stride) * 3;
            } else {
              player.step *= 1 - Math.min(delta / 70, 1);
              if (Math.abs(player.step) < 0.05) {
                player.step = 0;
                player.stride = 0;
              }
            }
            const pose = Math.round(player.step * 2) || 0;
            if (pose !== player.pose) {
              player.portrait.setFrame(String(pose));
              player.pose = pose;
            }
            player.portrait.setPosition(x, y - Math.abs(player.step) / 2);
            player.label.setPosition(x, Math.max(14, y - 49));
            player.shadow.setPosition(x, y + 13);
            const table = this.tableAt(x, y);
            if (this.skippedTableId && table?.id !== this.skippedTableId) this.skippedTableId = null;
            if (table && table.id !== this.skippedTableId) {
              body.setVelocity(0, 0);
              this.trySit(table);
            }
          }
          async trySit(table) {
            const attempt = { id: table.id };
            this.pendingTable = attempt;
            const isCurrent = () => this.pendingTable === attempt;
            const result = await this.bridge.reserveTable(table.id, isCurrent);
            if (!isCurrent()) return;
            this.pendingTable = null;
            if (result !== "joined") {
              this.skippedTableId = table.id;
              this.bridge.onSeatDenied(table, result);
              return;
            }
            this.currentTableId = table.id;
            this.setAvatarVisible(false);
            this.renderTables();
            this.bridge.onEnterTable(table.id);
          }
        }
        /* Meeting tabs follow the currently occupied table. */
        class MeetingController {
          constructor(onState) {
            this.onState = onState;
            this.tableId = null;
            this.url = null;
            this.meetingWindow = null;
          }

          enterTable(table) {
            const url = table.sched?.open === false ? null : table.meeting?.url ?? null;
            if (this.tableId === table.id && this.url === url) return;

            this.exitTable();
            this.tableId = table.id;
            this.url = url;
            this.openMeeting();
          }

          openMeeting() {
            if (this.url) {
              try {
                const popup = window.open("about:blank", "_blank");
                if (popup) {
                  try {
                    popup.opener = null;
                    popup.location.replace(this.url);
                    this.meetingWindow = popup;
                  } catch {
                    popup.close();
                  }
                }
              } catch {}
            }
            this.onState({
              tableId: this.tableId,
              needsClick: Boolean(this.url && !this.meetingWindow),
            });
          }

          retryExternal(table) {
            if (this.tableId === table.id && this.url === table.meeting?.url && !this.meetingWindow) {
              this.openMeeting();
            }
          }

          exitTable(tableId) {
            if (!this.tableId || (tableId && this.tableId !== tableId)) return;
            try { this.meetingWindow?.close(); } catch {}
            this.meetingWindow = null;
            this.tableId = null;
            this.url = null;
            this.onState({ tableId: null, needsClick: false });
          }
        }
        /* Meeting link validation */
        function parseMeetingUrl(value) {
          let url;
          try {
            url = new URL(String(value).trim());
          } catch {
            return {
              ok: false,
              error: "Not a valid URL",
            };
          }
          if (url.protocol !== "https:") {
            return {
              ok: false,
              error: "Meeting links must use https",
            };
          }
          const hostname = url.hostname.toLowerCase();
          if (
            hostname === "zoom.us" ||
            hostname.endsWith(".zoom.us") ||
            hostname.endsWith(".zoomgov.com")
          ) {
            const w = url.pathname.match(/\/(?:j|w|wc\/join)\/(\d{9,11})/);
            return w
              ? {
                  ok: true,
                  provider: "zoom",
                  url: url.toString(),
                }
              : {
                  ok: false,
                  error: "Zoom link is missing a meeting number",
                };
          }
          if (hostname === "meet.google.com") {
            const w = url.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i);
            return w
              ? {
                  ok: true,
                  provider: "meet",
                  url: url.toString(),
                }
              : {
                  ok: false,
                  error: "Google Meet link must look like meet.google.com/abc-defg-hij",
                };
          }
          if (hostname === "teams.microsoft.com" || hostname === "teams.live.com") {
            const meetingPath = /^\/meet\/\d+\/?$/i.test(url.pathname) ||
              /^\/l\/meetup-join\/[^/]+(?:\/\d+)?\/?$/i.test(url.pathname);
            return meetingPath
              ? { ok: true, provider: "teams", url: url.toString() }
              : { ok: false, error: "Use a Microsoft Teams meeting join link" };
          }
          return hostname === "webex.com" || hostname.endsWith(".webex.com")
            ? {
                ok: true,
                provider: "webex",
                url: url.toString(),
              }
            : {
                ok: false,
                error: "Unsupported platform. Supported: Zoom, Webex, Google Meet, and Teams",
              };
        }
        /* Closure times, days, and schedules */
        const MAX_CLOSED_TIMES = 10;
        const SHARED_CLOSED_TIME_ID = "shared-closed-time";
        const DEFAULT_CLOSED_TIME = { label: "Closed", start: "", end: "", days: [1, 2, 3, 4, 5] };
        const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const DAY_NUMBERS = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        const createId = (g = "c") => `${g}${Math.random().toString(36).slice(2, 8)}`;
        function parseTime(value) {
          const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value));
          return match ? Number(match[1]) * 60 + Number(match[2]) : null;
        }
        function formatTime(value) {
          const minutes = parseTime(value);
          if (minutes === null) {
            return "";
          }
          const hours = Math.floor(minutes / 60);
          const minuteText = String(minutes % 60).padStart(2, "0");
          return `${hours % 12 === 0 ? 12 : hours % 12}:${minuteText} ${hours < 12 ? "AM" : "PM"}`;
        }
        function isValidTimeZone(timeZone) {
          if (typeof timeZone != "string" || !timeZone) {
            return false;
          }
          try {
            new Intl.DateTimeFormat("en-US", {
              timeZone: timeZone,
            });
            return true;
          } catch {
            return false;
          }
        }
        function getLocalTime(date, timeZone) {
          const options = {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          };
          let formatter;
          try {
            formatter = new Intl.DateTimeFormat("en-US", {
              ...options,
              timeZone: timeZone,
            });
          } catch {
            formatter = new Intl.DateTimeFormat("en-US", options);
          }
          const parts = Object.fromEntries(formatter.formatToParts(date).map((X) => [X.type, X.value]));
          return {
            day: DAY_NUMBERS[parts.weekday],
            minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
          };
        }
        function validateClosedTimes(closedTimes) {
          if (!Array.isArray(closedTimes)) return failure("Closed times must be a list");
          if (closedTimes.length > MAX_CLOSED_TIMES) {
            return failure(`A table can have at most ${MAX_CLOSED_TIMES} closed times`);
          }
          const ids = new Set();
          const validatedTimes = [];
          for (const closedTime of closedTimes) {
            const start = String(closedTime?.start ?? "");
            const end = String(closedTime?.end ?? "");
            if (parseTime(start) === null || parseTime(end) === null) {
              return failure("Closed times need a start and end time");
            }
            if (start === end) {
              return failure("A closed time must end at a different time than it starts");
            }
            const days = [...new Set((Array.isArray(closedTime?.days) ? closedTime.days : []).map(Number))]
              .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
              .sort((first, second) => first - second);
            if (!days.length) return failure("Pick at least one day for each closed time");

            let id = typeof closedTime.id === "string" && closedTime.id ? closedTime.id.slice(0, 40) : createId();
            while (ids.has(id)) id = createId();
            ids.add(id);
            validatedTimes.push({
              id,
              label: cleanText(closedTime.label, 30) || DEFAULT_CLOSED_TIME.label,
              start,
              end,
              days,
            });
          }
          return { ok: true, closedTimes: validatedTimes };
        }
        function minutesUntilReopen(closedTime, minutes) {
          const start = parseTime(closedTime.start);
          const end = parseTime(closedTime.end);
          return start < end ? end - minutes : minutes >= start ? 1440 - minutes + end : end - minutes;
        }
        function closedTimeApplies(closedTime, day, minutes) {
          const start = parseTime(closedTime.start);
          const end = parseTime(closedTime.end);
          return start < end
            ? closedTime.days.includes(day) && minutes >= start && minutes < end
            : (closedTime.days.includes(day) && minutes >= start) ||
                (closedTime.days.includes((day + 6) % 7) && minutes < end);
        }
        function getTableSchedule(table, date, timeZone) {
          if (table.forceClosed) {
            return {
              open: false,
              reason: "manual",
              label: "Closed",
              reopensAt: null,
            };
          }
          const { day, minutes } = getLocalTime(date, timeZone);
          let activeTime = null;
          let longestWait = 0;
          for (const closedTime of table.closedTimes || []) {
            if (!closedTimeApplies(closedTime, day, minutes)) continue;
            const wait = minutesUntilReopen(closedTime, minutes);
            if (wait > longestWait) {
              activeTime = closedTime;
              longestWait = wait;
            }
          }
          return activeTime
            ? { open: false, reason: "schedule", label: activeTime.label, reopensAt: activeTime.end }
            : { open: true, reason: null, label: null, reopensAt: null };
        }
        function describeClosedTime(schedule) {
          return !schedule || schedule.open
            ? null
            : {
                title:
                  !schedule.label || schedule.label.toLowerCase() === "closed"
                    ? "Closed"
                    : `Closed for ${schedule.label.toLowerCase()}`,
                detail: schedule.reopensAt ? `Back ${formatTime(schedule.reopensAt)}` : "",
              };
        }
        /* Table validation and default tables */
        const cleanText = (value, maxLength) => String(value ?? "").trim().slice(0, maxLength);
        const DEFAULT_TABLE_CAPACITY = 5;
        const MAX_TABLE_CAPACITY = 999;

        function validateTable(input = {}, existingTable = null) {
          const name = cleanText(input.name === undefined ? existingTable?.name : input.name, 40);
          if (!name) return failure("Table name is required");
          const capacityValue = input.capacity === undefined
            ? existingTable?.capacity ?? DEFAULT_TABLE_CAPACITY
            : input.capacity;
          const capacity = typeof capacityValue === "string" ? Number(capacityValue) : capacityValue;
          if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_TABLE_CAPACITY) {
            return failure(`Seat capacity must be a whole number from 1 to ${MAX_TABLE_CAPACITY}.`);
          }

          let meeting = existingTable?.meeting || null;
          if (input.meetingUrl !== undefined) {
            const url = String(input.meetingUrl || "").trim();
            if (!url) {
              meeting = null;
            } else if (meeting?.url !== url) {
              const { ok, error, ...details } = parseMeetingUrl(url);
              if (!ok) return failure(error);
              meeting = details;
            }
          }

          let closedTimes = existingTable?.closedTimes || [];
          if (input.closedTimes !== undefined) {
            const validation = validateClosedTimes(input.closedTimes);
            if (!validation.ok) return validation;
            closedTimes = validation.closedTimes;
          }

          return {
            ok: true,
            table: {
              id: existingTable?.id,
              name,
              capacity,
              host: cleanText(input.host === undefined ? existingTable?.host : input.host, 40),
              caption: cleanText(input.caption === undefined ? existingTable?.caption : input.caption, 80),
              meeting,
              closedTimes,
              forceClosed: input.forceClosed === undefined ? !!existingTable?.forceClosed : !!input.forceClosed,
            },
          };
        }
        function createTableId(name, existingIds) {
          const usedIds = existingIds instanceof Set ? existingIds : new Set(existingIds);
          const baseId =
            String(name)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 30) || "table";
          if (!usedIds.has(baseId)) {
            return baseId;
          }
          let B = 2;
          for (; usedIds.has(`${baseId}-${B}`);) {
            B++;
          }
          return `${baseId}-${B}`;
        }
        // A fresh setup starts with one page of tables.
        function createDefaultTables() {
          return Array.from({ length: TABLES_PER_PAGE }, (_, index) => {
            const number = tableNumber(index);
            const name = `Table ${number}`;
            return { ...validateTable({ name }).table, id: `table-${number}` };
          });
        }
        const cloneConfig = (g) => JSON.parse(JSON.stringify(g));
        const failure = (error) => ({ ok: false, error });
        function planMeetingImport(tables, records) {
          const nextTables = tables.slice();
          const ids = new Set(tables.map((table) => table.id));
          const nameKey = (name) => cleanText(name, 40).toLowerCase();
          const reservedNames = new Set([
            ...tables.map((table) => nameKey(table.name)),
            ...records.map((record) => nameKey(record.name)),
          ]);
          const namedRows = new Set();
          const changes = [];
          let added = 0;
          let updated = 0;

          for (const record of records) {
            const key = nameKey(record.name);
            const matches = key ? nextTables.filter((table) => nameKey(table.name) === key) : [];
            if (key && namedRows.has(key)) {
              return failure(`${record.location}: the table name is repeated in the file.`);
            }
            if (matches.length > 1) {
              return failure(`${record.location}: multiple existing tables use that name.`);
            }
            if (key) namedRows.add(key);

            const existing = matches[0];
            const result = validateTable({
              name: existing?.name || record.name || "Meeting",
              caption: record.caption || undefined,
              meetingUrl: record.meetingUrl,
            }, existing);
            if (!result.ok) return failure(`${record.location}: ${result.error}`);

            const table = result.table;
            if (existing) {
              if (table.meeting.url === existing.meeting?.url && table.caption === existing.caption) continue;
              nextTables[nextTables.indexOf(existing)] = table;
              updated++;
              changes.push(`Update ${table.name}`);
              continue;
            }

            if (!key) {
              if (nextTables.some((existingTable) => existingTable.meeting?.url === table.meeting.url)) continue;
              const base = `${PROVIDER_LABELS[table.meeting.provider]} table`;
              let number = 1;
              while (reservedNames.has(nameKey(`${base} ${number}`))) number++;
              table.name = `${base} ${number}`;
              reservedNames.add(nameKey(table.name));
            }
            table.id = createTableId(table.name, ids);
            ids.add(table.id);
            nextTables.push(table);
            added++;
            changes.push(`Add ${table.name}`);
          }

          return { ok: true, tables: nextTables, changes, added, updated, skipped: records.length - changes.length };
        }
        /* Table storage and editing operations */
        function createTableStore({ load: load, save: save, tz: timeZone }) {
          const defaultTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
          let config = loadConfig();
          function loadConfig() {
            let saved;
            try {
              saved = load?.();
            } catch {}
            if (!Array.isArray(saved?.tables)) return { tz: defaultTimeZone, tables: createDefaultTables() };

            const tables = [];
            const ids = new Set();
            for (const table of saved.tables) {
              const validated = validateTable({ ...table, meetingUrl: table?.meeting?.url ?? table?.meetingUrl ?? "" });
              if (!validated.ok) continue;
              const id = typeof table.id === "string" && table.id && !ids.has(table.id)
                ? table.id
                : createTableId(validated.table.name, ids);
              ids.add(id);
              tables.push({ ...validated.table, id });
            }
            return { tz: isValidTimeZone(saved.tz) ? saved.tz : defaultTimeZone, tables };
          }
          function persist() {
            try {
              if (save) {
                save(cloneConfig(config));
              }
            } catch {}
          }
          function saveTableList(tables, errorMessage) {
            const nextConfig = { ...config, tables };
            try {
              if (load && JSON.stringify(loadConfig()) !== JSON.stringify(config)) {
                return failure("Tables changed in another tab. Reload Cherry Commons and try again.");
              }
              save?.(cloneConfig(nextConfig));
            } catch {
              return failure(errorMessage);
            }
            config = nextConfig;
            return { ok: true };
          }

          function removeTables(ids) {
            const selected = new Set(ids);
            const remaining = config.tables.filter((table) => !selected.has(table.id));
            if (!selected.size || config.tables.length - remaining.length !== selected.size) {
              return failure("One or more selected tables could not be found.");
            }
            return saveTableList(remaining, "Could not save the deletion in this browser.");
          }

          return {
            getConfig: () => cloneConfig(config),
            addTable(t) {
              const u = validateTable(t, null);
              if (!u.ok) {
                return failure(u.error);
              }
              const p = {
                ...u.table,
                id: createTableId(
                  u.table.name,
                  config.tables.map((o) => o.id),
                ),
              };
              config.tables.push(p);
              persist();
              return {
                ok: true,
              };
            },
            importTables(records) {
              const plan = planMeetingImport(config.tables, records);
              if (!plan.ok || !plan.changes.length) return plan;

              const result = saveTableList(plan.tables, "Could not save the import in this browser.");
              return result.ok ? plan : result;
            },
            updateTable(t, u) {
              const p = config.tables.findIndex((n) => n.id === t);
              if (p < 0) {
                return failure("Table not found");
              }
              const o = validateTable(u || {}, config.tables[p]);
              return o.ok
                ? ((config.tables[p] = {
                    ...o.table,
                    id: t,
                  }),
                  persist(),
                  {
                    ok: true,
                  })
                : failure(o.error);
            },
            removeTables,
            removeTable: (id) => removeTables([id]),
            moveTable(t, u) {
              const p = config.tables.findIndex((n) => n.id === t);
              if (p < 0) {
                return failure("Table not found");
              }
              const o = p + (Number(u) < 0 ? -1 : 1);
              if (o >= 0 && o < config.tables.length) {
                (([config.tables[p], config.tables[o]] = [config.tables[o], config.tables[p]]), persist());
              }
              return {
                ok: true,
              };
            },
            setTz(t) {
              return isValidTimeZone(t)
                ? ((config.tz = t),
                  persist(),
                  {
                    ok: true,
                  })
                : failure("That time zone is not recognized");
            },
            setSharedClosedTime(settings) {
              const validation = validateClosedTimes([{
                ...settings,
                id: SHARED_CLOSED_TIME_ID,
                label: DEFAULT_CLOSED_TIME.label,
              }]);
              if (!validation.ok) return validation;
              const [closedTime] = validation.closedTimes;
              const tables = config.tables.map((table) => ({
                ...table,
                closedTimes: [
                  ...table.closedTimes.filter((time) => time.id !== SHARED_CLOSED_TIME_ID),
                  closedTime,
                ],
              }));
              if (tables.some((table) => table.closedTimes.length > MAX_CLOSED_TIMES)) {
                return failure("A table has reached its closed-time limit. Remove one of its closed times and try again.");
              }
              return saveTableList(tables, "Could not save the closed time in this browser.");
            },
            clearSharedClosedTime() {
              const tables = config.tables.map((table) => ({
                ...table,
                closedTimes: table.closedTimes.filter((time) => time.id !== SHARED_CLOSED_TIME_ID),
              }));
              return saveTableList(tables, "Could not remove the closed time in this browser.");
            },
          };
        }
        /* Table placement and page navigation */
        const GRID_COLUMNS = 4;
        const TABLES_PER_PAGE = GRID_COLUMNS * 3;

        function layoutTables(tables) {
          return tables.map((table, index) => {
            const slot = index % TABLES_PER_PAGE;
            return {
              ...table,
              index,
              page: Math.floor(index / TABLES_PER_PAGE),
              x: 80 + (slot % GRID_COLUMNS) * 300,
              y: 110 + Math.floor(slot / GRID_COLUMNS) * 205,
              w: 220,
              h: 110,
            };
          });
        }

        const PRESENCE_TIMEOUT = 90_000;

        function readSeatCounts(prefix, ownKey) {
          const counts = Object.create(null);
          const now = Date.now();
          for (const key of Object.keys(localStorage)) {
            if (key === ownKey || !key.startsWith(prefix)) continue;
            let record;
            try { record = JSON.parse(localStorage.getItem(key)); } catch { continue; }
            if (typeof record?.desk !== "string" || !(record.until > now)) continue;
            counts[record.desk] = (counts[record.desk] ?? 0) + 1;
          }
          return counts;
        }

        function writeSeat(key, table) {
          localStorage.setItem(key, JSON.stringify({ desk: table, until: Date.now() + PRESENCE_TIMEOUT }));
        }

        // The lock keeps two tabs from claiming the last seat at the same time.
        async function claimSeat(prefix, key, table, getCapacity, isCurrent) {
          try {
            if (!navigator.locks) return "unavailable";
            return await navigator.locks.request(prefix + "admission", () => {
              if (!isCurrent()) return "cancelled";
              const capacity = getCapacity();
              if (!capacity) return "closed";
              if ((readSeatCounts(prefix, key)[table] ?? 0) >= capacity) return "full";
              writeSeat(key, table);
              return "joined";
            });
          } catch {
            return "unavailable";
          }
        }

        function useTablePresence(roomId, onSeatReset) {
          const sitePath = new URL(".", location.href).pathname;
          const prefix = `cc.seat.room.${encodeURIComponent(sitePath)}.${roomId}.`;
          const [key] = React.useState(() => prefix + (crypto.randomUUID?.() ?? createId("visitor")));
          const seat = React.useRef(null);
          const [counts, setCounts] = React.useState({});

          const refresh = React.useCallback(() => {
            let next;
            try { next = readSeatCounts(prefix); } catch { return; }
            setCounts((previous) =>
              Object.keys(next).length === Object.keys(previous).length &&
              Object.keys(next).every((table) => next[table] === previous[table])
                ? previous : next,
            );
          }, [prefix]);

          const clearSeat = React.useCallback(() => {
            seat.current = null;
            try { localStorage.removeItem(key); } catch {}
          }, [key]);

          const releaseSeat = React.useCallback(() => {
            clearSeat();
            refresh();
          }, [clearSeat, refresh]);

          React.useEffect(() => {
            function resetForPageHide() {
              onSeatReset(false);
              clearSeat();
            }
            function sync(event) {
              if (!event.key || event.key.startsWith(prefix)) refresh();
            }
            async function renew() {
              try {
                if (seat.current) {
                  await navigator.locks.request(prefix + "admission", () => {
                    if (!seat.current) return;
                    const record = JSON.parse(localStorage.getItem(key));
                    if (record?.desk === seat.current && record.until > Date.now()) {
                      writeSeat(key, seat.current);
                    } else {
                      clearSeat();
                      onSeatReset(true);
                    }
                  });
                }
              } catch {
                clearSeat();
                onSeatReset(true);
              }
              refresh();
            }
            const timer = setInterval(renew, 15_000);
            window.addEventListener("storage", sync);
            window.addEventListener("pagehide", resetForPageHide);
            window.addEventListener("pageshow", refresh);
            document.addEventListener("visibilitychange", renew);
            refresh();
            return () => {
              clearInterval(timer);
              window.removeEventListener("storage", sync);
              window.removeEventListener("pagehide", resetForPageHide);
              window.removeEventListener("pageshow", refresh);
              document.removeEventListener("visibilitychange", renew);
              clearSeat();
            };
          }, [prefix, key, clearSeat, onSeatReset, refresh]);

          return {
            counts,
            releaseSeat,
            async reserveSeat(table, getCapacity, isCurrent) {
              const result = await claimSeat(prefix, key, table, getCapacity, isCurrent);
              if (result === "joined") seat.current = table;
              refresh();
              return result;
            },
          };
        }

        function TablePages({ page, count, onChange }) {
          return jsxRuntime.jsxs("nav", {
            className: "table-pages",
            "aria-label": "Table pages",
            children: [
              jsxRuntime.jsx("button", { disabled: page === 0, onClick: () => onChange(page - 1), children: "Previous" }),
              jsxRuntime.jsx("span", { "aria-live": "polite", children: `Page ${page + 1} of ${count}` }),
              jsxRuntime.jsx("button", { disabled: page + 1 >= count, onClick: () => onChange(page + 1), children: "Next" }),
            ],
          });
        }
        /* Table editor and weekday picker */
        const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
        function DayPicker({ days: days, onChange: onChange }) {
          const toggleDay = (w) => onChange(days.includes(w) ? days.filter((B) => B !== w) : [...days, w]);
          return jsxRuntime.jsx("div", {
            className: "days",
            role: "group",
            "aria-label": "Days of the week",
            children: WEEKDAY_ORDER.map((w) =>
              jsxRuntime.jsx(
                "button",
                {
                  type: "button",
                  className: days.includes(w) ? "day on" : "day",
                  "aria-pressed": days.includes(w),
                  onClick: () => toggleDay(w),
                  children: DAY_LABELS[w],
                },
                w,
              ),
            ),
          });
        }
        function TableEditor({ table, api, onDone }) {
          const [form, setForm] = React.useState(() => ({
            name: table?.name || "",
            host: table?.host || "",
            caption: table?.caption || "",
            capacity: table?.capacity ?? DEFAULT_TABLE_CAPACITY,
            meetingUrl: table?.meeting?.url || "",
            closedTimes: table?.closedTimes || [],
            forceClosed: !!table?.forceClosed,
          }));
          const [error, setError] = React.useState("");
          const [confirmDelete, setConfirmDelete] = React.useState(false);
          const [saving, setSaving] = React.useState(false);
          const updateForm = (patch) => setForm((previous) => ({ ...previous, ...patch }));
          const updateClosedTime = (id, patch) =>
            updateForm({
              closedTimes: form.closedTimes.map((time) => time.id === id ? { ...time, ...patch } : time),
            });
          const meetingPreview = form.meetingUrl.trim() ? parseMeetingUrl(form.meetingUrl) : null;
          async function saveTable() {
            setSaving(true);
            setError("");
            const l = table ? await api.updateTable(table.id, form) : await api.addTable(form);
            setSaving(false);
            if (l.error) {
              return setError(l.error);
            }
            onDone(!table);
          }
          async function deleteTable() {
            if (!confirmDelete) {
              return setConfirmDelete(true);
            }
            const l = await api.removeTable(table.id);
            if (l.error) {
              return setError(l.error);
            }
            onDone();
          }
          return jsxRuntime.jsxs("div", {
            className: "editor",
            children: [
              jsxRuntime.jsx("h3", {
                children: table ? `Edit ${table.name}` : "Add a table",
              }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Table name",
                  jsxRuntime.jsx("input", {
                    value: form.name,
                    maxLength: 40,
                    onChange: (l) =>
                      updateForm({
                        name: l.target.value,
                      }),
                  }),
                ],
              }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Host or nickname",
                  jsxRuntime.jsx("input", {
                    value: form.host,
                    maxLength: 40,
                    placeholder: "Shown under the table name",
                    onChange: (l) =>
                      updateForm({
                        host: l.target.value,
                      }),
                  }),
                ],
              }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Caption",
                  jsxRuntime.jsx("input", {
                    value: form.caption,
                    maxLength: 80,
                    placeholder: "A short line, like “Drop-in hours”",
                    onChange: (l) =>
                      updateForm({
                        caption: l.target.value,
                      }),
                  }),
                ],
              }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Meeting link",
                  jsxRuntime.jsx("input", {
                    value: form.meetingUrl,
                    placeholder: "Paste a Zoom, Teams, Google Meet, or Webex link",
                    onChange: (l) =>
                      updateForm({
                        meetingUrl: l.target.value,
                      }),
                  }),
                ],
              }),
              meetingPreview &&
                jsxRuntime.jsx("div", {
                  className: meetingPreview.ok ? "note ok" : "note bad",
                  children: meetingPreview.ok
                    ? `Detected: ${PROVIDER_LABELS[meetingPreview.provider]}`
                    : meetingPreview.error,
                }),
              !form.meetingUrl.trim() &&
                jsxRuntime.jsx("div", {
                  className: "note",
                  children: "Leave empty until you have a meeting link.",
                }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Seat capacity",
                  jsxRuntime.jsx("input", {
                    type: "number",
                    min: 1,
                    max: MAX_TABLE_CAPACITY,
                    step: 1,
                    value: form.capacity,
                    onChange: (event) => updateForm({ capacity: event.target.value }),
                  }),
                ],
              }),
              jsxRuntime.jsx("h4", {
                children: "Closed times",
              }),
              jsxRuntime.jsx("p", {
                className: "note",
                children:
                  "The table is unavailable during its closed times.",
              }),
              form.closedTimes.map((l) =>
                jsxRuntime.jsxs(
                  "div",
                  {
                    className: "closed-time",
                    children: [
                      jsxRuntime.jsx("input", {
                        "aria-label": "Reason",
                        value: l.label,
                        maxLength: 30,
                        onChange: (i) =>
                          updateClosedTime(l.id, {
                            label: i.target.value,
                          }),
                      }),
                      jsxRuntime.jsxs("div", {
                        className: "times",
                        children: [
                          jsxRuntime.jsx("input", {
                            type: "time",
                            "aria-label": "Closes at",
                            value: l.start,
                            onChange: (i) =>
                              updateClosedTime(l.id, {
                                start: i.target.value,
                              }),
                          }),
                          jsxRuntime.jsx("span", {
                            children: "to",
                          }),
                          jsxRuntime.jsx("input", {
                            type: "time",
                            "aria-label": "Reopens at",
                            value: l.end,
                            onChange: (i) =>
                              updateClosedTime(l.id, {
                                end: i.target.value,
                              }),
                          }),
                        ],
                      }),
                      jsxRuntime.jsx(DayPicker, {
                        days: l.days,
                        onChange: (i) =>
                          updateClosedTime(l.id, {
                            days: i,
                          }),
                      }),
                      jsxRuntime.jsx("button", {
                        className: "rm",
                        onClick: () =>
                          updateForm({
                            closedTimes: form.closedTimes.filter((i) => i.id !== l.id),
                          }),
                        children: "Remove",
                      }),
                    ],
                  },
                  l.id,
                ),
              ),
              jsxRuntime.jsx("button", {
                disabled: form.closedTimes.length >= MAX_CLOSED_TIMES,
                onClick: () =>
                  updateForm({
                    closedTimes: [
                      ...form.closedTimes,
                      {
                        ...DEFAULT_CLOSED_TIME,
                        id: createId(),
                      },
                    ],
                  }),
                children: "Add closed time",
              }),
              jsxRuntime.jsxs("label", {
                className: "check",
                children: [
                  jsxRuntime.jsx("input", {
                    type: "checkbox",
                    checked: form.forceClosed,
                    onChange: (l) =>
                      updateForm({
                        forceClosed: l.target.checked,
                      }),
                  }),
                  "Close this table now, until I reopen it",
                ],
              }),
              error &&
                jsxRuntime.jsx("div", {
                  className: "note bad",
                  role: "alert",
                  children: error,
                }),
              jsxRuntime.jsxs("div", {
                className: "row",
                children: [
                  jsxRuntime.jsx("button", {
                    className: "primary",
                    disabled: saving || !form.name.trim(),
                    onClick: saveTable,
                    children: table ? "Save changes" : "Add table",
                  }),
                  jsxRuntime.jsx("button", {
                    onClick: onDone,
                    children: "Cancel",
                  }),
                ],
              }),
              table &&
                jsxRuntime.jsx("button", {
                  className: "danger",
                  onClick: deleteTable,
                  onBlur: () => setConfirmDelete(false),
                  children: confirmDelete ? "Click again to delete this table" : "Delete table",
                }),
            ],
          });
        }
        function getTimeZones(currentTimeZone) {
          let timeZones = [];
          try {
            timeZones = Intl.supportedValuesOf("timeZone");
          } catch {}
          timeZones.length ||
            (timeZones = [
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
              "UTC",
            ]);
          return timeZones.includes(currentTimeZone) ? timeZones : [currentTimeZone, ...timeZones];
        }
        /* Building hours and table management */
        function BuildingHours({ config: config, api: api }) {
          const sharedTime = config.tables
            .flatMap((table) => table.closedTimes ?? [])
            .find((time) => time.id === SHARED_CLOSED_TIME_ID);
          const initialTime = sharedTime || DEFAULT_CLOSED_TIME;
          const [closedTimeStart, setClosedTimeStart] = React.useState(initialTime.start);
          const [closedTimeEnd, setClosedTimeEnd] = React.useState(initialTime.end);
          const [days, setDays] = React.useState(initialTime.days);
          const [message, setMessage] = React.useState("");
          async function applySharedClosedTime() {
            const n = await api.setSharedClosedTime({
              start: closedTimeStart,
              end: closedTimeEnd,
              days: days,
            });
            setMessage(n.error || "Closed time set for every table.");
          }
          async function removeSharedClosedTime() {
            const n = await api.clearSharedClosedTime();
            setMessage(n.error || "Shared closed time removed.");
          }
          return jsxRuntime.jsxs("div", {
            className: "building",
            children: [
              jsxRuntime.jsx("h4", {
                children: "Building hours",
              }),
              jsxRuntime.jsxs("label", {
                children: [
                  "Time zone",
                  jsxRuntime.jsx("select", {
                    value: config.tz,
                    onChange: (n) => api.setTz(n.target.value),
                    children: getTimeZones(config.tz).map((n) =>
                      jsxRuntime.jsx(
                        "option",
                        {
                          value: n,
                          children: n.replace(/_/g, " "),
                        },
                        n,
                      ),
                    ),
                  }),
                ],
              }),
              jsxRuntime.jsx("p", {
                className: "note",
                children: "Closed times follow this time zone, whatever time zone visitors are in.",
              }),
              jsxRuntime.jsxs("div", {
                className: "closed-time",
                children: [
                  jsxRuntime.jsx("strong", {
                    children: "Closed time for all tables",
                  }),
                  jsxRuntime.jsxs("div", {
                    className: "times",
                    children: [
                      jsxRuntime.jsx("input", {
                        type: "time",
                        "aria-label": "Shared closed time starts",
                        value: closedTimeStart,
                        onChange: (n) => setClosedTimeStart(n.target.value),
                      }),
                      jsxRuntime.jsx("span", {
                        children: "to",
                      }),
                      jsxRuntime.jsx("input", {
                        type: "time",
                        "aria-label": "Shared closed time ends",
                        value: closedTimeEnd,
                        onChange: (n) => setClosedTimeEnd(n.target.value),
                      }),
                    ],
                  }),
                  jsxRuntime.jsx(DayPicker, {
                    days: days,
                    onChange: setDays,
                  }),
                  jsxRuntime.jsxs("div", {
                    className: "row",
                    children: [
                      jsxRuntime.jsx("button", {
                        className: "primary",
                        onClick: applySharedClosedTime,
                        children: "Apply to all tables",
                      }),
                      jsxRuntime.jsx("button", {
                        onClick: removeSharedClosedTime,
                        children: "Remove from all",
                      }),
                    ],
                  }),
                  message &&
                    jsxRuntime.jsx("div", {
                      className: "note",
                      role: "status",
                      children: message,
                    }),
                ],
              }),
            ],
          });
        }
        function MeetingTableImport({ tables, onImport, onAdded }) {
          const fileInput = React.useRef(null);
          const [reading, setReading] = React.useState(false);
          const [records, setRecords] = React.useState(null);
          const [feedback, setFeedback] = React.useState(null);
          const plan = records && planMeetingImport(tables, records);

          async function selectFile(event) {
            const file = event.currentTarget.files[0];
            event.currentTarget.value = "";
            if (!file) return;
            setRecords(null);
            setFeedback(null);
            setReading(true);
            try {
              setRecords(await readMeetingFile(file));
            } catch (error) {
              setFeedback({ error: error.message || "Could not read the meeting list." });
            } finally {
              setReading(false);
            }
          }

          async function applyImport() {
            const result = await onImport(records);
            if (!result.ok) {
              setFeedback(result);
              return;
            }
            setRecords(null);
            setFeedback({
              message: `Added ${result.added}, updated ${result.updated}, skipped ${result.skipped}.`,
            });
            if (result.added) onAdded();
          }

          const error = feedback?.error || plan?.error;
          return jsxRuntime.jsxs("section", {
            className: "editor",
            "aria-label": "Meeting list import",
            children: [
              jsxRuntime.jsx("input", {
                ref: fileInput,
                type: "file",
                accept: MEETING_FILE_TYPES,
                hidden: true,
                onChange: selectFile,
              }),
              jsxRuntime.jsx("button", {
                type: "button",
                disabled: reading,
                onClick: () => fileInput.current.click(),
                children: reading ? "Reading file…" : "Upload meeting list",
              }),
              jsxRuntime.jsx("p", {
                className: "note",
                children: "Excel, ODS, JSON, CSV, TSV, or TXT. Include one meeting link per row or use meeting_url, name, and caption. Only the meeting link is required.",
              }),
              plan?.ok && jsxRuntime.jsxs("div", {
                children: [
                  jsxRuntime.jsx("p", {
                    className: "note",
                    role: "status",
                    children: `Preview: ${plan.added} to add, ${plan.updated} to update, ${plan.skipped} to skip.`,
                  }),
                  plan.changes.length > 0 && jsxRuntime.jsx("ul", {
                    children: plan.changes.slice(0, 8).map((change) => jsxRuntime.jsx("li", { children: change }, change)),
                  }),
                  plan.changes.length > 8 && jsxRuntime.jsx("p", {
                    className: "note",
                    children: `And ${plan.changes.length - 8} more.`,
                  }),
                  jsxRuntime.jsxs("div", {
                    className: "row",
                    children: [
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "primary",
                        disabled: !plan.changes.length,
                        onClick: applyImport,
                        children: "Import tables",
                      }),
                      jsxRuntime.jsx("button", {
                        type: "button",
                        onClick: () => {
                          setRecords(null);
                          setFeedback(null);
                        },
                        children: "Cancel import",
                      }),
                    ],
                  }),
                ],
              }),
              error && jsxRuntime.jsx("p", { className: "note bad", role: "alert", children: error }),
              feedback?.message && jsxRuntime.jsx("p", { className: "note ok", role: "status", children: feedback.message }),
            ],
          });
        }
        function TableManager({
          config: config,
          tables,
          allTables,
          page,
          onAdded,
          api,
        }) {
          const [editingTableId, setEditingTableId] = React.useState(null);
          const [error, setError] = React.useState("");
          const [selectedIds, setSelectedIds] = React.useState([]);
          const [confirmDelete, setConfirmDelete] = React.useState(false);
          const [deleteStatus, setDeleteStatus] = React.useState("");
          const selectedOnPage = tables.filter((table) => selectedIds.includes(table.id)).map((table) => table.id);
          const allSelected = tables.length > 0 && selectedOnPage.length === tables.length;

          React.useEffect(() => {
            setSelectedIds([]);
            setConfirmDelete(false);
          }, [page]);

          function selectTables(ids) {
            setSelectedIds(ids);
            setConfirmDelete(false);
            setDeleteStatus("");
            setError("");
          }

          async function deleteSelected() {
            const result = await api.removeTables(selectedOnPage);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            selectTables([]);
            setDeleteStatus(`Deleted ${selectedOnPage.length} ${selectedOnPage.length === 1 ? "table" : "tables"}.`);
          }
          if (editingTableId) {
            const o = editingTableId === "new" ? null : config.tables.find((n) => n.id === editingTableId);
            if (editingTableId === "new" || o) {
              return jsxRuntime.jsx(
                TableEditor,
                {
                  table: o,
                  api: api,
                  onDone: (added) => {
                    setEditingTableId(null);
                    if (added === true) onAdded();
                  },
                },
                editingTableId,
              );
            }
          }
          async function runAction(o) {
            setError("");
            const n = await o();
            if (n != null && n.error) {
              setError(n.error);
            }
          }
          return jsxRuntime.jsxs("div", {
            className: "manager",
            children: [
              jsxRuntime.jsx(MeetingTableImport, {
                tables: config.tables,
                onImport: api.importTables,
                onAdded,
              }),
              jsxRuntime.jsx("h4", {
                children: "Tables on this page",
              }),
              tables.length > 0 && jsxRuntime.jsxs("div", {
                className: "table-bulk-actions",
                children: [
                  jsxRuntime.jsx("button", {
                    type: "button",
                    onClick: () => selectTables(allSelected ? [] : tables.map((table) => table.id)),
                    children: allSelected ? "Clear selection" : "Select all on this page",
                  }),
                  jsxRuntime.jsx("button", {
                    type: "button",
                    className: "danger",
                    disabled: !selectedOnPage.length || confirmDelete,
                    onClick: () => setConfirmDelete(true),
                    children: selectedOnPage.length ? `Delete selected (${selectedOnPage.length})` : "Delete selected",
                  }),
                ],
              }),
              confirmDelete && selectedOnPage.length > 0 && jsxRuntime.jsxs("div", {
                className: "table-row",
                role: "group",
                "aria-label": "Confirm table deletion",
                children: [
                  jsxRuntime.jsx("div", {
                    children: `Permanently delete ${selectedOnPage.length} ${selectedOnPage.length === 1 ? "selected table" : "selected tables"}?`,
                  }),
                  jsxRuntime.jsxs("div", {
                    className: "table-bulk-actions",
                    children: [
                      jsxRuntime.jsx("button", {
                        type: "button",
                        className: "danger",
                        onClick: deleteSelected,
                        children: "Confirm deletion",
                      }),
                      jsxRuntime.jsx("button", {
                        type: "button",
                        onClick: () => {
                          setConfirmDelete(false);
                          setError("");
                        },
                        children: "Cancel",
                      }),
                    ],
                  }),
                ],
              }),
              deleteStatus && jsxRuntime.jsx("div", { className: "note ok", role: "status", children: deleteStatus }),
              tables.length === 0 &&
                jsxRuntime.jsx("div", {
                  className: "note",
                  children: "No tables yet. Add one to get started.",
                }),
              tables.map((o) =>
                jsxRuntime.jsxs(
                  "div",
                  {
                    className: "table-row",
                    children: [
                      jsxRuntime.jsxs("div", {
                        className: "table-head",
                        children: [
                          jsxRuntime.jsxs("label", {
                            className: "table-select",
                            children: [
                              jsxRuntime.jsx("input", {
                                type: "checkbox",
                                "aria-label": `Select ${o.name}`,
                                checked: selectedOnPage.includes(o.id),
                                onChange: (event) => selectTables(event.target.checked
                                  ? [...selectedOnPage, o.id]
                                  : selectedOnPage.filter((id) => id !== o.id)),
                              }),
                              jsxRuntime.jsx("span", { className: "name", children: o.name }),
                            ],
                          }),
                          jsxRuntime.jsx("em", {
                            children: describeTableStatus(o),
                          }),
                        ],
                      }),
                      jsxRuntime.jsxs("div", {
                        className: "table-actions",
                        children: [
                          jsxRuntime.jsx("button", {
                            onClick: () => setEditingTableId(o.id),
                            children: "Edit",
                          }),
                          jsxRuntime.jsx("button", {
                            onClick: () =>
                              runAction(() =>
                                api.updateTable(o.id, {
                                  forceClosed: !o.forceClosed,
                                }),
                              ),
                            children: o.forceClosed ? "Reopen" : "Close now",
                          }),
                          jsxRuntime.jsx("button", {
                            "aria-label": `Move ${o.name} earlier`,
                            disabled: o.index === 0,
                            onClick: () => runAction(() => api.moveTable(o.id, -1)),
                            children: "↑",
                          }),
                          jsxRuntime.jsx("button", {
                            "aria-label": `Move ${o.name} later`,
                            disabled: o.index === allTables.length - 1,
                            onClick: () => runAction(() => api.moveTable(o.id, 1)),
                            children: "↓",
                          }),
                        ],
                      }),
                    ],
                  },
                  o.id,
                ),
              ),
              jsxRuntime.jsx("button", {
                className: "primary",
                onClick: () => setEditingTableId("new"),
                children: "Add a table",
              }),
              error &&
                jsxRuntime.jsx("div", {
                  className: "note bad",
                  role: "alert",
                  children: error,
                }),
              jsxRuntime.jsx("p", {
                className: "note",
                children: "Each page holds up to 12 tables. Use the arrows to change their order.",
              }),
              jsxRuntime.jsx(BuildingHours, {
                config: config,
                api: api,
              }),
              jsxRuntime.jsx("p", {
                className: "note",
                children: "Meeting links are visible to anyone who can enter this room.",
              }),
            ],
          });
        }
        /* Application settings and welcome screen */
        const HEADWEAR_COLORS = {
          cap: "#38619f",
          beanie: "#ab4e71",
          sunhat: "#dbb578",
          "bunny-ears": "#fff1f5",
          "cat-ears": "#4e405b",
          "bear-ears": "#855941",
          "devil-horns": "#b63150",
          "unicorn-horn": "#f3c669",
        };
        const AVATAR_OPTIONS = {
          skin: { label: "Skin tone", values: { Fair: "#f6d2b8", Light: "#e6b68e", Golden: "#c88e5e", Tan: "#a86c47", Brown: "#805036", Deep: "#543126" } },
          hairStyle: {
            label: "Hair style",
            menu: true,
            values: {
              Short: "short", Curly: "curly", Long: "long", Shaved: "shaved",
              Ponytail: "ponytail", "Side part": "side-part", Bob: "bob", Bun: "bun",
              Pixie: "pixie", Braids: "braids", Afro: "afro", Wavy: "wavy",
            },
          },
          hair: { label: "Hair color", values: { Black: "#242024", Brown: "#61402c", Blonde: "#d8ad62", Auburn: "#943e27", Silver: "#b6b6be" } },
          shirt: { label: "Shirt color", values: { Blue: "#4f8cff", Green: "#25836b", Red: "#c7505c", Gold: "#d5992e", Purple: "#8a60c0", White: "#f0eee6" } },
          bottoms: { label: "Bottoms", menu: true, values: { Pants: "pants", Shorts: "shorts", Skirt: "skirt" } },
          pants: { label: "Bottoms color", values: { Navy: "#303c57", Black: "#26282c", Denim: "#547ba5", Khaki: "#b49e77", Olive: "#59664c" } },
          shoes: { label: "Shoes", values: { Charcoal: "#282b30", White: "#efefeb", Brown: "#664432", Red: "#ab3549" } },
          accessory: { label: "Accessory", menu: true, values: { None: "none", Glasses: "glasses", Headphones: "headphones", Earbuds: "earbuds" } },
          hat: {
            label: "Headwear",
            menu: true,
            values: {
              None: "none", Cap: "cap", Beanie: "beanie", Sunhat: "sunhat",
              "Bunny ears": "bunny-ears", "Cat ears": "cat-ears", "Bear ears": "bear-ears",
              "Devil horns": "devil-horns", "Unicorn horn": "unicorn-horn",
            },
          },
          hatColor: {
            label: "Headwear color",
            values: { Default: "default", Blue: "#38619f", Pink: "#ab4e71", Red: "#b63150", Gold: "#f3c669", White: "#fff1f5", Black: "#28232b" },
          },
          bag: { label: "Bag", menu: true, values: { None: "none", Backpack: "backpack", Tote: "tote", Satchel: "satchel" } },
          bagColor: { label: "Bag color", values: { Brown: "#9a5c36", Black: "#344050", Plum: "#9c507a", Teal: "#287c76" } },
        };
        const DEFAULT_APPEARANCE = Object.fromEntries(
          Object.entries(AVATAR_OPTIONS).map(([key, option]) => [key, Object.values(option.values)[0]]),
        );

        // Shared shapes keep the welcome preview and map avatar consistent.
        // Parts are painted in order, so the list below runs back to front:
        // back hair -> bag (behind) -> legs and bottoms -> arms -> shirt
        // -> bag (in front) -> head -> front hair -> face -> accessory -> hat.
        function avatarParts(appearance, step = 0) {
          const { skin, hairStyle, hair, shirt, bottoms, pants, shoes, accessory, hat, hatColor, bag, bagColor } = appearance;
          const ellipse = (x, y, width, height, color) => ({ type: "ellipse", x, y, width, height, color });
          const rect = (x, y, width, height, radius, color) => ({ type: "rect", x, y, width, height, radius, color });
          const polygon = (points, color) => ({
            type: "polygon",
            points: points.map(([x, y]) => ({ x, y })),
            color,
          });
          const parts = [];
          const shade = (color, amount) => "#" + [1, 3, 5]
            .map((start) => Math.min(255, Math.round(parseInt(color.slice(start, start + 2), 16) * amount))
              .toString(16).padStart(2, "0"))
            .join("");
          const bagEdge = bag === "none" ? bagColor : shade(bagColor, 0.68);
          const bagTrim = bag === "none" ? bagColor : shade(bagColor, 1.35);

          // The backpack is centered behind the torso, with the same edge visible on both sides.
          if (bag === "backpack") {
            parts.push(
              rect(-16.5, -13, 33, 21, 5, bagEdge),
              rect(-15.5, -12, 31, 19, 4, bagColor),
            );
          }
          if (hairStyle === "long") parts.push(rect(-15, -34, 30, 28, 11, hair));
          if (hairStyle === "bob") {
            parts.push(polygon([
              [-14, -12], [-14.5, -24], [-13, -30], [-9, -34], [-4, -36], [4, -36],
              [9, -34], [13, -30], [14.5, -24], [14, -12],
            ], hair));
          }
          if (hairStyle === "wavy") {
            for (const side of [-1, 1]) {
              parts.push(
                ellipse(side * 11, -26, 10, 17, hair),
                ellipse(side * 13, -16, 9, 13, hair),
                ellipse(side * 11, -9 + step / 5, 10, 10, hair),
              );
            }
          }
          if (hairStyle === "ponytail") {
            parts.push(
              ellipse(-12, -30, 8, 8, hair),
              ellipse(-16, -23 + step / 4, 9, 15, hair),
              ellipse(-17, -17 + step / 3, 7, 9, hair),
              ellipse(-13, -29, 4, 3, "#d9b573"),
            );
          }

          // Feet move in opposite directions as the body bobs.
          const legColor = bottoms === "pants" ? pants : skin;
          parts.push(
            rect(-10, 3, 9, 14 + step, 3, legColor),
            rect(1, 3, 9, 14 - step, 3, legColor),
            rect(-11, 14 + step, 10, 6, 3, shoes),
            rect(1, 14 - step, 10, 6, 3, shoes),
          );
          if (bottoms === "shorts") {
            parts.push(rect(-11, 3, 10, 8 + step / 2, 2, pants), rect(1, 3, 10, 8 - step / 2, 2, pants));
          }

          // Torso: arms first, then the shirt over their inner edges.
          parts.push(
            rect(-17, -9 - step / 2, 7, 16, 3, skin),
            rect(10, -9 + step / 2, 7, 16, 3, skin),
            rect(-15, -11, 30, 13, 5, shirt),
            rect(-11, -10, 22, 17, 4, shirt),
          );
          if (bottoms === "skirt") {
            parts.push(
              polygon([[-7.5, 3], [7.5, 3], [16, 14], [9, 15], [-9, 15], [-16, 14]], pants),
              polygon([[2, 4], [4, 4], [9, 14.5], [5, 15]], shade(pants, 0.82)),
            );
          }

          if (bag === "backpack") {
            parts.push(
              rect(-10, -11, 4, 15, 2, bagEdge), rect(6, -11, 4, 15, 2, bagEdge),
              rect(-9, -10, 2, 10, 1, bagTrim), rect(7, -10, 2, 10, 1, bagTrim),
            );
          } else if (bag === "tote") {
            const top = 2 + step / 3;
            // Seen edge-on, the handles overlap and the bag widens toward the bottom.
            parts.push(
              rect(9, -11, 6.5, 3, 1.5, bagEdge),
              polygon([[9, -9], [11.5, -10], [15.5, top + 2], [13, top + 2]], bagEdge),
              polygon([[13, -10], [15.5, -10], [19.5, top + 2], [17.5, top + 2]], bagTrim),
              polygon([[13, top], [19, top], [22, top + 11], [20, top + 13], [13, top + 13], [11.5, top + 11]], bagEdge),
              polygon([[14, top + 2], [18.5, top + 2], [20.5, top + 11.5], [13, top + 11.5]], bagColor),
              rect(14, top + 0.5, 4.5, 1.4, 0.7, bagTrim),
              polygon([[17, top + 2], [18, top + 2], [19.5, top + 11.5], [18.5, top + 11.5]], bagTrim),
            );
          } else if (bag === "satchel") {
            const top = 2 + step / 4;
            // The strap wraps into the near edge of the narrow gusset.
            parts.push(
              polygon([[-12, -11], [-9, -12], [16, top + 1], [14, top + 3.5]], bagEdge),
              polygon([[-11, -11], [-10, -11.5], [15, top + 1.5], [14, top + 2.5]], bagTrim),
              polygon([[13.5, top], [19, top], [21.5, top + 9], [20, top + 11], [13.5, top + 11], [12, top + 9]], bagEdge),
              polygon([[14.5, top + 2], [18.5, top + 2], [20, top + 9.5], [13.5, top + 9.5]], bagColor),
              rect(13, top, 6.5, 2.5, 1, bagTrim),
              rect(14.5, top + 0.5, 2, 2, 0.6, "#d9b573"),
            );
          }

          // Head, then the hair that sits on top of it.
          parts.push(ellipse(0, -21, 24, 24, skin));
          if (hairStyle === "short" || hairStyle === "long") {
            parts.push(ellipse(0, -30, 25, 11, hair), ellipse(-7, -26, 10, 10, hair));
          }
          if (hairStyle === "curly") {
            for (const x of [-9, -3, 3, 9]) parts.push(ellipse(x, -29 - (Math.abs(x) < 5 ? 3 : 0), 11, 11, hair));
          }
          if (hairStyle === "ponytail") {
            parts.push(ellipse(0, -31, 24, 12, hair), ellipse(-8, -27, 8, 10, hair));
          }
          if (hairStyle === "side-part") {
            parts.push(
              polygon([
                [-12.5, -24], [-13, -29], [-11, -33], [-7, -36], [-2, -37.5],
                [5.5, -36.5], [4, -32], [0, -29.5], [-5, -28], [-9, -28], [-11, -26],
              ], hair),
              polygon([[6.5, -36], [10.5, -33.5], [13, -30], [12, -23.5], [10, -27], [6.5, -29.5], [5, -32]], hair),
              polygon([[-10, -32], [-7, -34.5], [-2, -36], [3.5, -35.5], [-1, -34.5], [-6, -33]], shade(hair, 1.42)),
            );
          } else if (hairStyle === "bob") {
            parts.push(
              polygon([
                [-14, -12], [-14.5, -24], [-13, -30], [-9, -34], [-4, -36], [4, -36],
                [9, -34], [13, -30], [14.5, -24], [14, -12], [9.5, -12],
                [10, -22], [9, -27], [5, -26], [-5, -26], [-9, -27], [-10, -22], [-9.5, -12],
              ], hair),
              polygon([[-11.5, -29], [-8, -33], [-3, -34.5], [-7, -32], [-10, -28], [-12, -19]], shade(hair, 1.35)),
            );
          } else if (hairStyle === "bun") {
            parts.push(ellipse(0, -39, 12, 11, hair), rect(-4, -35.5, 8, 2, 1, "#d9b573"), ellipse(0, -30, 24, 11, hair));
          } else if (hairStyle === "pixie") {
            parts.push(
              polygon([
                [-12, -25], [-12, -29], [-10, -33], [-6, -35], [-1, -36.5],
                [4.5, -36.5], [8, -35], [11.5, -36], [11, -31], [12, -28], [11, -25],
                [8.5, -29], [5.5, -27], [6, -30], [1, -27], [-4, -28], [-8, -26.5], [-10.5, -25.5],
              ], hair),
              polygon([[-9.5, -31], [-6, -34], [-1, -35], [3.5, -35], [-1, -33.5], [-5.5, -32.5]], shade(hair, 1.42)),
            );
          } else if (hairStyle === "braids") {
            const braidBase = shade(hair, 0.75);
            const braidLight = shade(hair, 1.48);
            parts.push(
              ellipse(0, -31, 25, 11, hair),
              polygon([[-0.65, -35.8], [0.65, -35.8], [0.9, -28], [-0.9, -28]], skin),
            );
            for (const side of [-1, 1]) {
              const mirror = (points) => points.map(([x, y]) => [side * x, y]);
              const sway = side * step / 4;
              parts.push(polygon(mirror([
                [5, -34], [10, -33], [13, -29], [14.5, -24], [15.3, -18],
                [16 + sway, -10], [14.6 + sway, -5], [12.5 + sway, -7],
                [11.4, -15], [10.4, -23], [8.2, -29], [5, -31],
              ]), braidBase));
              for (const [index, [x, y, width]] of [[8, -32, 5.2], [10.6, -28, 5.2], [12.1, -24, 5.2], [13, -20, 4.8], [13.4, -16, 4.3], [14 + sway, -12, 3.9]].entries()) {
                const slant = index % 2 === 0 ? -1 : 1;
                parts.push(polygon(mirror([
                  [x - width / 2, y - slant - 0.9], [x + width / 2, y + slant - 0.9],
                  [x + width / 2 - 0.5, y + slant + 1.4], [x - width / 2 + 0.3, y - slant + 1.4],
                ]), index % 2 === 0 ? braidLight : hair));
              }
              parts.push(rect(side * (14 + sway) - 1.8, -8.8, 3.6, 1.5, 0.7, "#d9b573"));
            }
          } else if (hairStyle === "afro") {
            for (const [x, y, size] of [[-13, -28, 12], [-11, -36, 14], [-4, -39, 14], [4, -39, 14], [11, -36, 14], [13, -28, 12]]) {
              parts.push(ellipse(x, y, size, size, hair));
            }
            parts.push(ellipse(0, -33, 29, 14, hair));
          } else if (hairStyle === "wavy") {
            parts.push(ellipse(0, -31, 26, 12, hair), ellipse(-7, -28, 11, 9, hair));
          }

          // Face and accessories.
          parts.push(ellipse(-4, -21, 2.5, 3, "#282326"), ellipse(4, -21, 2.5, 3, "#282326"));
          if (accessory === "glasses") {
            parts.push(rect(-9, -24, 8, 6, 2, "#334253"), rect(1, -24, 8, 6, 2, "#334253"), rect(-2, -22, 4, 2, 1, "#334253"));
          }
          if (accessory === "headphones") {
            parts.push(rect(-14, -26, 5, 11, 2, "#324355"), rect(9, -26, 5, 11, 2, "#324355"));
          } else if (accessory === "earbuds") {
            for (const x of [-11, 11]) {
              parts.push(
                rect(x - 0.9, -20, 1.8, 4.8, 0.9, "#e0e7ed"),
                ellipse(x, -20, 3.7, 3.5, "#fffdfa"),
              );
            }
          }

          // Headwear uses its original palette until a swatch or custom color is selected.
          const paintHeadwear = (fallback, shadeFactor = 1) =>
            hatColor && hatColor !== "default" ? shade(hatColor, shadeFactor) : fallback;
          const headwearBase = paintHeadwear(HEADWEAR_COLORS[hat]);
          if (hat === "cap") {
            parts.push(ellipse(0, -33, 25, 13, headwearBase), rect(-13, -30, 26, 4, 2, paintHeadwear("#294a7f", 0.76)));
          } else if (hat === "beanie") {
            parts.push(ellipse(0, -34, 25, 16, headwearBase), ellipse(0, -42, 6, 6, paintHeadwear("#d47d9a", 1.28)),
              rect(-13, -33, 26, 6, 2, paintHeadwear("#893857", 0.78)));
          } else if (hat === "sunhat") {
            parts.push(ellipse(0, -30, 38, 7, headwearBase), ellipse(0, -34, 21, 15, paintHeadwear("#c89858", 0.9)),
              rect(-11, -34, 22, 3, 1, paintHeadwear("#8a5c45", 0.65)));
          } else if (hat === "bunny-ears") {
            for (const x of [-7, 7]) {
              parts.push(ellipse(x, -39.5, 6.7, 14.5, headwearBase), ellipse(x, -40, 3.1, 9.7, "#e891b6"));
            }
          } else if (hat === "cat-ears") {
            for (const side of [-1, 1]) {
              parts.push(
                polygon([[side * 4, -33], [side * 10.5, -44.5], [side * 12.2, -45], [side * 14.4, -32]], headwearBase),
                polygon([[side * 7.5, -34.5], [side * 11, -41.5], [side * 12.5, -34.5]], "#efa4b8"),
              );
            }
          } else if (hat === "bear-ears") {
            for (const x of [-10.4, 10.4]) {
              parts.push(ellipse(x, -36, 9.5, 9.2, headwearBase), ellipse(x, -36, 5.2, 5, "#dea982"));
            }
          } else if (hat === "devil-horns") {
            for (const side of [-1, 1]) {
              parts.push(
                polygon([[side * 5, -33], [side * 12, -32], [side * 15, -35.5], [side * 16, -40], [side * 14, -46], [side * 12, -41], [side * 8, -38]], headwearBase),
                polygon([[side * 9, -36], [side * 13.5, -38], [side * 14.5, -42.5], [side * 12, -40]], paintHeadwear("#ed6882", 1.28)),
              );
            }
          } else if (hat === "unicorn-horn") {
            parts.push(
              polygon([[-4, -34], [1, -47], [5, -34]], headwearBase),
              polygon([[-2.5, -39], [-1.5, -42], [3, -41], [3.8, -38]], paintHeadwear("#fff0ab", 1.25)),
            );
          }

          const headband = {
            "bunny-ears": "#a75581",
            "cat-ears": "#4e405b",
            "bear-ears": "#855941",
            "devil-horns": "#742440",
            "unicorn-horn": "#9068b0",
          }[hat];
          if (headband) {
            // Draw the narrow band over the bases so the attachments read as one piece.
            const arch = (radiusX, radiusY) => Array.from({ length: 13 }, (_, index) => {
              const angle = index * Math.PI / 12;
              return [radiusX * Math.cos(angle), -26.5 - radiusY * Math.sin(angle)];
            });
            parts.push(polygon([...arch(13.5, 9.5), ...arch(11.3, 7.3).reverse()], paintHeadwear(headband, 0.72)));
          }
          return parts;
        }
        function AvatarPreview({ appearance }) {
          return jsxRuntime.jsx("svg", {
            className: "avatar-preview",
            viewBox: "-30 -49 60 76",
            role: "img",
            "aria-label": "Avatar preview",
            children: avatarParts(appearance).map((part, index) =>
              part.type === "ellipse"
                ? jsxRuntime.jsx("ellipse", { cx: part.x, cy: part.y, rx: part.width / 2, ry: part.height / 2, fill: part.color }, index)
                : part.type === "polygon"
                  ? jsxRuntime.jsx("polygon", { points: part.points.map(({ x, y }) => `${x},${y}`).join(" "), fill: part.color }, index)
                  : jsxRuntime.jsx("rect", { x: part.x, y: part.y, width: part.width, height: part.height, rx: part.radius, fill: part.color }, index),
            ),
          });
        }
        function buildCommonsView(config, date) {
          const tables = layoutTables(config.tables);
          return {
            tables: tables.map((X) => {
              const c = getTableSchedule(X, date, config.tz);
              return {
                ...X,
                capacity: X.capacity ?? DEFAULT_TABLE_CAPACITY,
                sched: {
                  ...c,
                  ...(c.open ? {} : describeClosedTime(c)),
                },
              };
            }),
          };
        }
        function App() {
          const [profile, setProfile] = React.useState(null);
          const [invitation] = React.useState(invitationFromLocation);
          return profile
            ? jsxRuntime.jsx(RoomExperience, {
                invitation,
                renderRoom: (snapshot, onLeaveRoom) => jsxRuntime.jsx(Commons, {
                  profile, initialSnapshot: snapshot, onLeaveRoom,
                }, snapshot.room.id),
              })
            : jsxRuntime.jsx(Welcome, {
                onStart: setProfile,
              });
        }
        const STUDIO_SECTIONS = [
          { title: "Face & hair", fields: ["hairStyle", "hair", "skin", "accessory"] },
          { title: "Outfit", fields: ["shirt", "bottoms", "pants", "shoes"] },
          { title: "Accessories", fields: ["hat", "hatColor", "bag", "bagColor"] },
        ];
        const AVATAR_PRESETS = [
          { name: "Commons classic", outfit: { hat: "cap", bag: "backpack" } },
          { name: "Sunny afternoon", outfit: { hairStyle: "long", shirt: "#d5992e", bottoms: "skirt", pants: "#547ba5", hat: "sunhat", bag: "tote", bagColor: "#287c76" } },
          { name: "Study break", outfit: { hairStyle: "curly", shirt: "#8a60c0", bottoms: "shorts", pants: "#b49e77", accessory: "headphones", hat: "beanie", bag: "satchel", bagColor: "#9c507a" } },
        ];

        function hexToHsv(hex) {
          const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
          const [r, g, b] = channels;
          const v = Math.max(...channels);
          const chroma = v - Math.min(...channels);
          if (!chroma) return { h: 0, s: 0, v };
          const sector = v === r ? (g - b) / chroma : v === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
          return { h: (sector * 60 + 360) % 360, s: chroma / v, v };
        }

        function hsvToHex({ h, s, v }) {
          const channel = (offset) => {
            const sector = (offset + h / 60) % 6;
            const value = v - v * s * Math.max(0, Math.min(sector, 4 - sector, 1));
            return Math.round(value * 255).toString(16).padStart(2, "0");
          };
          return `#${channel(5)}${channel(3)}${channel(1)}`;
        }

        function StudioColorWheel({ label, initialColor, onChoose }) {
          const [color, setColor] = React.useState(() => hexToHsv(initialColor));
          const { h, s, v } = color;
          const angle = h * Math.PI / 180;

          function update(patch) {
            const next = { ...color, ...patch };
            setColor(next);
            onChoose(hsvToHex(next));
          }

          function selectAtPointer(event) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const radius = bounds.width / 2;
            if (!radius) return;
            const x = (event.clientX - bounds.left - radius) / radius;
            const y = (event.clientY - bounds.top - radius) / radius;
            const saturation = Math.min(1, Math.hypot(x, y));
            const hue = saturation ? (Math.atan2(y, x) * 180 / Math.PI + 360) % 360 : h;
            update({ h: hue, s: saturation });
          }

          return jsxRuntime.jsxs("div", {
            className: "studio-color-picker",
            role: "group",
            "aria-label": `Custom ${label.toLowerCase()}`,
            children: [
              jsxRuntime.jsx("div", {
                className: "studio-color-wheel",
                style: { "--shade": 1 - v },
                "aria-hidden": true,
                onPointerDown: (event) => {
                  if (event.button !== 0 || !event.isPrimary) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  selectAtPointer(event);
                },
                onPointerMove: (event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) selectAtPointer(event);
                },
                children: jsxRuntime.jsx("span", {
                  className: "studio-color-marker",
                  style: {
                    left: `${50 + 50 * s * Math.cos(angle)}%`,
                    top: `${50 + 50 * s * Math.sin(angle)}%`,
                    backgroundColor: hsvToHex(color),
                  },
                }),
              }),
              ...[
                ["Hue", "h", Math.min(359, Math.round(h)), 359],
                ["Saturation", "s", Math.round(s * 100), 100],
                ["Brightness", "v", Math.round(v * 100), 100],
              ].map(([name, key, value, max]) => jsxRuntime.jsxs("label", {
                className: "studio-color-slider",
                children: [
                  name,
                  jsxRuntime.jsx("input", {
                    type: "range", min: 0, max, value,
                    onChange: (event) => update({ [key]: Number(event.target.value) / (key === "h" ? 1 : 100) }),
                  }),
                ],
              }, key)),
              jsxRuntime.jsx("output", { children: hsvToHex(color).toUpperCase() }),
            ],
          });
        }

        function StudioChoices({ option, selected, onChoose, wheelOpen, onToggleWheel, onCloseWheel, wheelStartColor }) {
          const { label, values, menu } = option;
          const entries = Object.entries(values);
          const firstColor = entries.find(([, value]) => value.startsWith("#"))?.[1];
          const customSelected = selected.startsWith("#") && !entries.some(([, value]) => value === selected);
          return jsxRuntime.jsxs("fieldset", {
            className: "studio-field",
            children: [
              jsxRuntime.jsx("legend", { children: label }),
              menu
                ? jsxRuntime.jsx("select", {
                    "aria-label": label,
                    value: selected,
                    onChange: (event) => onChoose(event.target.value),
                    children: entries.map(([name, value]) => jsxRuntime.jsx("option", { value, children: name }, value)),
                  })
                : jsxRuntime.jsxs("div", {
                    className: "studio-choices",
                    children: [
                      ...entries.map(([name, value]) => {
                        const swatch = value.startsWith("#");
                        return jsxRuntime.jsx("button", {
                          type: "button",
                          className: swatch ? "studio-choice swatch" : "studio-choice",
                          style: swatch ? { "--swatch": value } : undefined,
                          "aria-label": swatch ? `${label}: ${name}` : undefined,
                          "aria-pressed": value === selected,
                          title: swatch ? name : undefined,
                          onClick: () => {
                            if (wheelOpen) onCloseWheel();
                            onChoose(value);
                          },
                          children: swatch ? null : name,
                        }, value);
                      }),
                      firstColor && jsxRuntime.jsxs("button", {
                        type: "button",
                        className: "studio-choice",
                        "aria-label": `Custom ${label.toLowerCase()}${customSelected ? `, selected ${selected}` : ""}`,
                        "aria-expanded": wheelOpen,
                        onClick: onToggleWheel,
                        children: [
                          customSelected && jsxRuntime.jsx("span", {
                            className: "studio-custom-swatch",
                            style: { backgroundColor: selected },
                            "aria-hidden": true,
                          }),
                          wheelOpen ? "Close wheel" : "Custom color",
                        ],
                      }),
                    ],
                  }),
              wheelOpen && firstColor && jsxRuntime.jsx(StudioColorWheel, {
                label,
                initialColor: selected.startsWith("#") ? selected : wheelStartColor ?? firstColor,
                onChoose,
              }),
            ],
          });
        }

        function Welcome({ onStart }) {
          const [name, setName] = React.useState("");
          const [appearance, setAppearance] = React.useState(() => ({
            ...DEFAULT_APPEARANCE, ...AVATAR_PRESETS[0].outfit,
          }));
          const [presetIndex, setPresetIndex] = React.useState(0);
          const [custom, setCustom] = React.useState(false);
          const [openColorWheel, setOpenColorWheel] = React.useState(null);

          function cyclePreset(direction) {
            const next = (presetIndex + direction + AVATAR_PRESETS.length) % AVATAR_PRESETS.length;
            setPresetIndex(next);
            setCustom(false);
            setOpenColorWheel(null);
            setAppearance((current) => ({
              ...DEFAULT_APPEARANCE,
              ...AVATAR_PRESETS[next].outfit,
              skin: current.skin,
              hair: current.hair,
            }));
          }

          function enterCommons(event) {
            event.preventDefault();
            if (name.trim()) {
              onStart({ name: name.trim(), color: colorToNumber(appearance.shirt), appearance });
            }
          }

          return jsxRuntime.jsx("main", {
            className: "avatar-studio",
            children: jsxRuntime.jsxs("div", {
              className: "studio-shell",
              children: [
                jsxRuntime.jsxs("header", {
                  className: "studio-header",
                  children: [
                    jsxRuntime.jsx("p", { className: "studio-kicker", children: "CHERRY COMMONS" }),
                    jsxRuntime.jsx("h1", { children: "Avatar studio" }),
                  ],
                }),
                jsxRuntime.jsxs("form", {
                  className: "studio-layout",
                  onSubmit: enterCommons,
                  children: [
                    jsxRuntime.jsxs("div", {
                      className: "studio-left",
                      children: [
                        jsxRuntime.jsxs("div", {
                          className: "studio-stage",
                          children: [
                            jsxRuntime.jsx(AvatarPreview, { appearance }),
                            jsxRuntime.jsxs("div", {
                              className: "studio-presets",
                              children: [
                                jsxRuntime.jsx("button", { type: "button", "aria-label": "Previous outfit", onClick: () => cyclePreset(-1), children: "‹" }),
                                jsxRuntime.jsx("span", { "aria-live": "polite", children: custom ? "Your custom look" : AVATAR_PRESETS[presetIndex].name }),
                                jsxRuntime.jsx("button", { type: "button", "aria-label": "Next outfit", onClick: () => cyclePreset(1), children: "›" }),
                              ],
                            }),
                          ],
                        }),
                        jsxRuntime.jsxs("label", {
                          className: "studio-name",
                          children: [
                            "Name",
                            jsxRuntime.jsx("input", {
                              "aria-label": "Your name",
                              placeholder: "Your name",
                              value: name,
                              maxLength: 24,
                              onChange: (event) => setName(event.target.value),
                            }),
                          ],
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs("div", {
                      className: "studio-options",
                      children: [
                        ...STUDIO_SECTIONS.map(({ title, fields }) =>
                          jsxRuntime.jsxs("section", {
                            className: "studio-section",
                            "aria-label": title,
                            children: [
                              jsxRuntime.jsx("h2", { children: title }),
                              ...fields.map((key) => jsxRuntime.jsx(StudioChoices, {
                                option: AVATAR_OPTIONS[key],
                                selected: appearance[key],
                                wheelStartColor: key === "hatColor" ? HEADWEAR_COLORS[appearance.hat] : undefined,
                                wheelOpen: openColorWheel === key,
                                onToggleWheel: () => setOpenColorWheel((open) => open === key ? null : key),
                                onCloseWheel: () => setOpenColorWheel(null),
                                onChoose: (value) => {
                                  if (key === "hat") setOpenColorWheel((open) => open === "hatColor" ? null : open);
                                  setCustom(true);
                                  setAppearance((current) => ({ ...current, [key]: value }));
                                },
                              }, key)),
                            ],
                          }, title),
                        ),
                        jsxRuntime.jsx("button", {
                          type: "submit",
                          className: "studio-enter",
                          disabled: !name.trim(),
                          children: "Enter commons",
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          });
        }
        function describeTableStatus(table, count = 0) {
          var w;
          if (((w = table.sched) == null ? void 0 : w.open) === false) {
            return table.sched.detail ? `Closed, ${table.sched.detail.toLowerCase()}` : "Closed";
          }
          if (count >= table.capacity) return "Full";
          if (!table.meeting) {
            return "Link pending";
          }
          return PROVIDER_LABELS[table.meeting.provider] || table.meeting.provider;
        }
        /* Commons state, map focus, and sidebar */
        function Commons({ profile, initialSnapshot, onLeaveRoom }) {
          const stageRef = React.useRef(null);
          const tablesRef = React.useRef([]);
          const sceneRef = React.useRef(null);
          const directoryRef = React.useRef(initialSnapshot);
          const storeRef = React.useRef(null);
          storeRef.current ??= createTableStore({ load: () => initialSnapshot.config, tz: initialSnapshot.config.tz });
          const [config, setConfig] = React.useState(() => storeRef.current.getConfig());
          const [room, setRoom] = React.useState(initialSnapshot.room);
          const [admin, setAdmin] = React.useState(initialSnapshot.admin);
          const [now, setNow] = React.useState(() => new Date());
          const [meetingState, setMeetingState] = React.useState({ tableId: null, needsClick: false });
          const [managerOpen, setManagerOpen] = React.useState(false);
          const managingTables = admin && managerOpen;
          const writePending = React.useRef(false);
          const roomPath = `/rooms/${initialSnapshot.room.id}`;

          function applyDirectory(snapshot) {
            setAdmin(snapshot.admin);
            const current = directoryRef.current;
            const newerRoom = snapshot.room.revision > current.room.revision;
            const newerTables = snapshot.revision > current.revision;
            if (newerRoom) setRoom(snapshot.room);
            if (newerTables) {
              storeRef.current = createTableStore({ load: () => snapshot.config, tz: snapshot.config.tz });
              setConfig(storeRef.current.getConfig());
            }
            if (newerRoom || newerTables) {
              directoryRef.current = {
                ...current,
                room: newerRoom ? snapshot.room : current.room,
                config: newerTables ? snapshot.config : current.config,
                revision: newerTables ? snapshot.revision : current.revision,
              };
            }
          }

          React.useEffect(() => {
            let active = true;
            let reading = false;
            async function refreshDirectory() {
              if (reading) return;
              reading = true;
              try {
                const snapshot = await roomRequest(roomPath);
                if (active) applyDirectory(snapshot);
              } catch (error) {
                if (active && (error.status === 403 || error.status === 404)) onLeaveRoom(error.message);
              } finally {
                reading = false;
              }
            }
            const timer = setInterval(refreshDirectory, 10000);
            window.addEventListener("focus", refreshDirectory);
            return () => {
              active = false;
              clearInterval(timer);
              window.removeEventListener("focus", refreshDirectory);
            };
          }, []);

          const [banner, setBanner] = React.useState("");
          const resetSeat = React.useCallback((expired) => {
            sceneRef.current?.leaveTable();
            if (expired) setBanner("Your seat expired. Walk onto the table mat to try again.");
          }, []);
          const { counts, reserveSeat, releaseSeat } = useTablePresence(room.id, resetSeat);
          const meetingController = React.useMemo(
            () => new MeetingController(setMeetingState),
            [],
          );
          const commonsView = React.useMemo(
            () => buildCommonsView(config, now),
            [config, now],
          );
          const [requestedPage, setPage] = React.useState(0);
          const pageCount = Math.max(1, Math.ceil(commonsView.tables.length / TABLES_PER_PAGE));
          const page = Math.min(requestedPage, pageCount - 1);
          const visibleTables = React.useMemo(
            () => commonsView.tables.filter((table) => table.page === page),
            [commonsView, page],
          );
          tablesRef.current = visibleTables;
          React.useEffect(() => {
            if (page !== requestedPage) setPage(page);
          }, [page, requestedPage]);
          React.useEffect(() => {
            const z = setInterval(() => setNow(new Date()), 15e3);
            return () => clearInterval(z);
          }, []);
          React.useEffect(() => {
            const scene = sceneRef.current;
            if (!scene) return;
            scene.setPage(page, visibleTables);
            if (!scene.currentTableId) return;
            const table = visibleTables.find((item) => item.id === scene.currentTableId);
            if (table) {
              meetingController.enterTable(table);
            } else {
              meetingController.exitTable();
            }
          }, [page, visibleTables]);
          React.useEffect(() => {
            sceneRef.current?.setCounts(counts);
          }, [counts]);
          async function updateTables(operation) {
            if (!managingTables) return { error: "Sign in as an admin to manage tables." };
            if (writePending.current) return { error: "A change is already being saved. Try again shortly." };
            const snapshot = directoryRef.current;
            writePending.current = true;
            try {
              const draft = createTableStore({ load: () => snapshot.config, tz: snapshot.config.tz });
              const result = operation(draft);
              if (!result.ok) return result;
              const nextConfig = draft.getConfig();
              if (JSON.stringify(nextConfig) === JSON.stringify(storeRef.current.getConfig())) return result;
              const saved = await roomRequest(roomPath + "/tables", { config: nextConfig, revision: snapshot.revision });
              applyDirectory(saved);
              return result;
            } catch (error) {
              if (error.status === 409) {
                try { applyDirectory(await roomRequest(roomPath)); } catch {}
              }
              return { error: error.message };
            } finally {
              writePending.current = false;
            }
          }

          const tableApi = {
            importTables: (records) => updateTables((store) => store.importTables(records)),
            addTable: (table) => updateTables((store) => store.addTable(table)),
            updateTable: (id, table) => updateTables((store) => store.updateTable(id, table)),
            removeTables: (ids) => updateTables((store) => store.removeTables(ids)),
            removeTable: (id) => updateTables((store) => store.removeTable(id)),
            moveTable: (id, direction) => updateTables((store) => store.moveTable(id, direction)),
            setTz: (timeZone) => updateTables((store) => store.setTz(timeZone)),
            setSharedClosedTime: (settings) => updateTables((store) => store.setSharedClosedTime(settings)),
            clearSharedClosedTime: () => updateTables((store) => store.clearSharedClosedTime()),
          };
          React.useEffect(() => {
            let active = true;
            const bridge = {
              me: profile,
              roomName: () => directoryRef.current.room.name,
              reserveTable: (id, isCurrent) => {
                const tableCapacity = () => {
                  const config = storeRef.current.getConfig();
                  const table = config.tables.find((item) => item.id === id);
                  return table && getTableSchedule(table, new Date(), config.tz).open ? table.capacity : null;
                };
                return reserveSeat(id, tableCapacity, () => active && isCurrent());
              },
              onSeatDenied: (table, result) => {
                if (result === "full") setBanner(`${table.name} is full. Try again when a seat opens.`);
                if (result === "closed") setBanner(`${table.name} is closed.`);
                if (result === "unavailable") setBanner("Seat availability could not be checked. Open this page in a modern browser over HTTPS or on localhost.");
              },
              onEnterTable: (id) => {
                setBanner("");
                const table = tablesRef.current.find((item) => item.id === id);
                if (table) meetingController.enterTable(table);
              },
              onExitTable: (id) => {
                releaseSeat();
                meetingController.exitTable(id);
              },
            };
            const game = new Phaser.Game({
              type: Phaser.AUTO,
              parent: stageRef.current,
              width: INITIAL_WORLD.w,
              height: INITIAL_WORLD.h,
              scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH,
              },
              physics: {
                default: "arcade",
                arcade: { customUpdate: true, fixedStep: false },
              },
              input: {
                keyboard: {
                  target: stageRef.current,
                },
              },
              scene: [],
            });
            const scene = new CommonsScene();
            sceneRef.current = scene;
            game.scene.add("world", scene, false);
            const firstPage = buildCommonsView(storeRef.current.getConfig(), new Date()).tables.slice(0, TABLES_PER_PAGE);
            tablesRef.current = firstPage;
            game.scene.start("world", { bridge, tables: firstPage, page: 0 });

            return () => {
              active = false;
              sceneRef.current = null;
              meetingController.exitTable();
              game.destroy(true);
            };
          }, []);
          React.useEffect(() => {
            const title = sceneRef.current?.floorTitle;
            if (title) fitText(title.setText(room.name.toUpperCase()), 490);
          }, [room.name]);
          const pendingMeeting = meetingState.needsClick
            ? visibleTables.find((table) => table.id === meetingState.tableId && table.meeting)
            : null;
          return jsxRuntime.jsx("main", {
            className: "commons",
            children: jsxRuntime.jsxs("div", {
              className: "commons-shell",
              children: [
                jsxRuntime.jsxs("header", {
                  className: "studio-header room-map-heading",
                  children: [
                    jsxRuntime.jsxs("div", {
                      children: [
                        jsxRuntime.jsx("h1", { children: room.name }),
                        jsxRuntime.jsx("span", { className: "room-badge", children: room.visibility === "private" ? "Private room" : "Public room" }),
                      ],
                    }),
                    jsxRuntime.jsx("button", { type: "button", onClick: () => onLeaveRoom(), children: "Room lobby" }),
                  ],
                }),
                jsxRuntime.jsxs("div", {
                  className: "app",
                  children: [
                    jsxRuntime.jsxs("section", {
                      className: "commons-map",
                      "aria-label": `${room.name} floor`,
                      children: [
                        jsxRuntime.jsx("div", {
                          className: "stage",
                          "aria-label": "Walk with arrow keys or WASD",
                          ref: stageRef,
                          tabIndex: 0,
                          onPointerDown: (z) => z.currentTarget.focus(),
                          onKeyDown: (event) => {
                            if (!event.repeat && /^(Arrow(Up|Down|Left|Right)|Key[WASD])$/.test(event.code)) {
                              sceneRef.current?.leaveTable();
                            }
                          },
                          onBlur: () => {
                            const z = sceneRef.current;
                            if (z && z.input && z.input.keyboard) {
                              z.input.keyboard.resetKeys();
                            }
                          },
                        }),
                        jsxRuntime.jsx("p", {
                          className: "hint",
                          children:
                            "Click the floor, then use arrows or WASD. Walk onto a table mat to sit. Press a movement key to stand.",
                        }),
                      ],
                    }),
                    jsxRuntime.jsxs("aside", {
                      className: "side",
                      children: [
                        jsxRuntime.jsxs("header", {
                          children: [
                            jsxRuntime.jsx("h2", { children: "Table directory" }),
                            admin && jsxRuntime.jsx("button", {
                              onClick: () => setManagerOpen(!managerOpen),
                              children: managingTables ? "Done" : "Manage tables",
                            }),
                          ],
                        }),
                        banner &&
                          jsxRuntime.jsx("div", {
                            className: "banner",
                            role: "status",
                            onClick: () => setBanner(""),
                            children: banner,
                          }),
                        pageCount > 1 && jsxRuntime.jsx(TablePages, { page, count: pageCount, onChange: setPage }),
                        pendingMeeting &&
                          jsxRuntime.jsx("button", {
                            className: "open-table-meeting",
                            onClick: () => meetingController.retryExternal(pendingMeeting),
                            children: `Open meeting · ${pendingMeeting.name}`,
                          }),
                        managingTables
                          ? jsxRuntime.jsx(TableManager, {
                              config: config,
                              tables: visibleTables,
                              allTables: commonsView.tables,
                              page,
                              onAdded: () => setPage(Math.floor(config.tables.length / TABLES_PER_PAGE)),
                              api: tableApi,
                            })
                          : jsxRuntime.jsxs(jsxRuntime.Fragment, {
                              children: [
                                jsxRuntime.jsx("div", {
                                  className: "legend",
                                  children: visibleTables.map((z) => {
                                    const count = counts[z.id] ?? 0;
                                    const availability = !z.sched.open ? " closed" : count >= z.capacity ? " full" : "";
                                    return jsxRuntime.jsxs(
                                      "div",
                                      {
                                        className: `legend-row${z.id === meetingState.tableId ? " here" : ""}${availability}`,
                                        children: [
                                          jsxRuntime.jsx("span", {
                                            className: "table-number",
                                            "aria-label": `Table ${z.index + 1}`,
                                            children: tableNumber(z.index),
                                          }),
                                          jsxRuntime.jsxs("div", {
                                            className: "table-summary",
                                            children: [
                                              jsxRuntime.jsx("span", { className: "name", children: z.name }),
                                              jsxRuntime.jsx("span", {
                                                className: "table-provider",
                                                children: describeTableStatus(z, count),
                                              }),
                                            ],
                                          }),
                                          jsxRuntime.jsx("em", {
                                            title: `${count} of ${z.capacity} seats occupied`,
                                            children: `${count}/${z.capacity}`,
                                          }),
                                        ],
                                      },
                                      z.id,
                                    );
                                  }),
                                }),
                              ],
                            }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          });
        }
        createRoot(document.getElementById("root")).render(jsxRuntime.jsx(App, {}));
      }

bootCherryCommons();
