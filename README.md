# Cherry Commons

Cherry Commons is a virtual commons for meeting at shared tables. Customize an avatar,
walk around the floor, and sit at a table. A table can open a configured Zoom,
Google Meet, Microsoft Teams, or Webex link in a separate browser tab.

## Run locally

From the project folder, run:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). The app uses browser modules
and runs over HTTP with the dependencies included in this folder.

Click the floor, then move with the arrow keys or WASD. Walk onto a table mat
to sit and press a movement key to stand. Use **Manage tables** to edit tables
and add meeting links. When the publishable key is blank, the app runs locally
and the demo sign-in is `admin` / `root`.

## Enable live counts and a shared directory

The Supabase project URL and publishable key are set in
`src/supabase-config.js`. Complete these steps in your Supabase project before
publishing the shared version.

1. In **SQL Editor**, open a new query, paste the contents of
   `supabase-setup.sql`, and run it. This creates the shared directory, seeds
   the numbered tables, and restricts edits to approved organizers.
2. In **Authentication → Users**, create or choose a confirmed email/password
   user for the organizer and copy its **User UID**. In **SQL Editor**, run the
   organizer command at the bottom of `supabase-setup.sql` without the comment
   markers and with your User UID in place of the placeholder.
3. Keep **Realtime** and **Allow public access to channels** enabled in the
   Supabase Realtime settings for this public site. Publish the updated files
   to GitHub Pages, open **Manage tables**, and sign in as the organizer.

Shared imports, edits, deletions, order, and closed times are published to all
visitors. The directory is publicly readable, so use meeting links intended
for public access. Previously imported local lists can be re-uploaded from
their original files after you sign in to the shared directory.

Open the site in a regular and private window and click **Enter commons** in
both. Check that the directory shows **2 online**, then sit at a table and
check its seat count in the other window. Presence counts open sessions.
They show seats occupied in the app. Simultaneous arrivals on different
devices can race because admission is not enforced by the database.

## Delete multiple tables

In **Manage tables**, check the tables you want to remove or choose
**Select all on this page**. Click **Delete selected** and confirm the deletion.

## Set closed times

Edit a table to set its own **Closed times**. To use one schedule for all
current tables, enter the start, end, and days under **Closed time for all
tables** in **Building hours**. Schedules use the selected time zone. Removing
the shared time leaves individual table schedules in place.

Older saved setups keep their table names, meeting links, and schedules. The
previous default closure label becomes **Closed**.

## Import a meeting list

In **Manage tables**, choose **Upload meeting list**, select a file, review the
preview, and click **Import tables**.

| File type | Layout |
| --- | --- |
| Excel (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`) or OpenDocument (`.ods`) | Only the first worksheet is read. Use a `meeting_url` column or one link per row in a single column. Clickable link cells are supported. |
| CSV or TSV (`.csv`, `.tsv`) | Use a `meeting_url` column or one link per row in a single column. |
| JSON (`.json`) | Use an array of URL strings or objects with a `meeting_url` field. You can also wrap the array in `tables`, `meetings`, or `links`. |
| Plain text (`.txt`) | Put one meeting link per line. |

Use optional `name` and `caption` columns or JSON fields to label tables.

```csv
name,meeting_url,caption
Study table,https://zoom.us/j/12345678901,Drop-in session
Discussion table,https://meet.google.com/abc-defg-hij,"Questions, ideas, and notes"
```

Use HTTPS join links for Zoom, Google Meet, Microsoft Teams, or Webex. Links
without a name get a generated name, such as **Zoom table 1**. A named entry
updates an existing table with the same name, regardless of case. An unnamed
entry with a matching link is skipped. An invalid entry stops the import
before any changes are saved.

Files are read in the browser. In shared mode, confirmed imports are saved to
the shared directory. Each file can contain
up to 500 meeting entries and be up to 1 MB.

## Publish with GitHub Pages

1. Create a GitHub repository and upload the extracted files to the root of
   its `main` branch. Include `.nojekyll` and the `src/` and `vendor/` folders.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select **main** and **/ (root)**, then save.

[GitHub Pages publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

The app opens meetings in provider tabs. With Supabase configured, use
**Manage tables** to set shared defaults.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | App entry page |
| `src/styles.css` | Interface styles |
| `src/app.js` | Avatar, map, table management, and meeting links |
| `src/supabase-config.js` | Public Supabase project settings |
| `src/shared-commons.js` | Organizer sign-in, directory sync, and presence |
| `supabase-setup.sql` | One-time database and permissions setup |
| `src/meeting-import.js` | File parsing and normalization for meeting table imports |
| `src/workbook-worker.js` | Reads spreadsheet files in a browser worker |
| `vendor/runtime.js` | Bundled React, React DOM, Scheduler, and Phaser |
| `vendor/sheetjs/` | SheetJS Community Edition and its license |
| `THIRD_PARTY_NOTICES.txt` | Bundled software attribution and license terms |

The notices cover the bundled dependencies. The Cherry Commons application
code has no separate open-source license in this release.
