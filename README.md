# Cherry Commons on GitHub Pages

Every room is a green floor with its own tables. Meeting links belong to
tables. Public rooms are open to visitors. Organizers can protect private
rooms with a password, a 24-hour invite link, or both.

## Set up Supabase

1. Open the existing Cherry Commons project in Supabase. This package keeps
   the original project URL and browser publishable key in
   `src/supabase-config.js`. For a different project, use its HTTPS Supabase
   URL and publishable key. Keep privileged keys out of the repository.
2. In **SQL Editor**, run `supabase-pages-rooms.sql`. If this is a fresh
   project, run `supabase-setup.sql` first to create the original directory
   and organizer list. The new migration enables `pgcrypto` in the standard
   Supabase `extensions` schema and adds a room endpoint.
3. In **SQL Editor**, run `supabase-pages-presence.sql` after the rooms
   migration. It enables shared visitor and seat counts in the hosted app.
4. Sign in with an existing organizer's Supabase email and password. If you
   need to add an organizer, create a confirmed email/password user under
   **Authentication → Users**, then run this in **SQL Editor** with that
   user's ID.

   ```sql
   insert into public.cc_organizers (user_id)
   values ('YOUR_AUTH_USER_UID'::uuid)
   on conflict do nothing;
   ```

The default **Cherry Commons** floor uses the existing `cc_directory` table.
The prior Pages build can continue reading its tables while the floor is
public. Making that floor private also restricts the old directory endpoint
to organizers. Keep the floor public if the prior build still serves public
visitors. Replace meeting links that were already shared publicly when
moving them to a private room.

Rooms and edits made with the Python test server are in its local SQLite
database. Re-create those rooms in the hosted app and use **Upload meeting
list** in each room to import the links you want to carry over. Guests use
the room password or invite link to unlock the floor.

## Publish on GitHub Pages

1. Extract this package and upload its contents to the publishing branch
   at the repository root. Include the hidden `.nojekyll` file and the
   `src` and `vendor` directories. If replacing an existing site, place the
   new `index.html` at the existing publishing root.
2. In the GitHub repository, open **Settings → Pages**. Under **Build and
   deployment**, select **Deploy from a branch**, then choose **main** and
   **/ (root)**, or the branch you use for publishing.
3. Open the HTTPS address listed in **Settings → Pages**. Asset and
   invitation URLs work under a project path such as
   `https://username.github.io/cherry-commons/`.

[GitHub Pages publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Test before publishing

After the SQL is applied, open a terminal in the folder containing
`index.html` and serve the static files.

| System | Command |
| --- | --- |
| Windows | `py -3 -m http.server 8000 --bind 127.0.0.1` |
| macOS or Linux | `python3 -m http.server 8000 --bind 127.0.0.1` |

Open [http://127.0.0.1:8000](http://127.0.0.1:8000), choose an avatar, and
enter the lobby. Select **Admin sign in** and use the organizer's Supabase
credentials. Create a private room and add a link under **Manage tables**.
Use an incognito window to test both the password and an invite generated
from **Room settings**. Local preview connects to the configured Supabase
database, so edits there also affect the hosted floors.

Invite links are reusable for 24 hours. Generating a replacement or
revoking a link ends access granted through the old one. A successful
unlock is valid for up to eight hours in that browser tab. The floor checks
access again periodically and when the tab regains focus. The lobby
displays room names. Private table names and links are sent after unlock.
The visitor list and table seat counts are shared across browsers in the
same room. Open the published site in two browser profiles and enter the
same room. Both should show two visitors within a few seconds. Sit at a
table in one browser and check the seat count in the other. Returning to
the lobby removes that session from the room. A dropped connection can
take up to 90 seconds to clear.

To add multiple tables, choose **Manage tables → Upload meeting list** from
the intended room. The app supports Excel, ODS, JSON, CSV, TSV, and TXT.
Use a `meeting_url` column and optionally `name` and `caption`.
