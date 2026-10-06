# Deploying the TESDA Assessment Scheduler

**Architecture:** the GitHub repo is the source of truth for both code and data.
Staff run the app **on their own computer**, make changes there (new
assessments, checklist ticks, Excel uploads, code edits — everything), and
push to GitHub. Render hosts a **read-only mirror** that redeploys
automatically from whatever is on GitHub, for anyone who just needs to view
it online. Nobody should enter real data directly on the Render URL — the
live app shows a warning banner if they try.

This means: **no persistent disk, no `APP_DATA_DIR` on Render, and Render's
free plan works fine** for this setup, since Render never needs to remember
anything between deploys — it just redeploys with whatever `data/` folder
was last pushed.

---

## Before you start: what you'll need

- A GitHub account (free) — [github.com](https://github.com)
- A Render account (free) — [render.com](https://render.com)
- [Git](https://git-scm.com/downloads) installed on every computer that will
  run the app or push changes
- [Python 3.11+](https://www.python.org/downloads/) installed on every
  computer that will run the app locally (check **"Add Python to PATH"**
  during install on Windows)

---

## Part A — One-time setup

### Step 1: Create the GitHub repository

1. Go to [github.com](https://github.com) and sign in.
2. Click **+** → **New repository**.
3. Name it (e.g. `tesda-assessment-scheduler`), set visibility to **Private**
   (this holds personal data — names, addresses), and click **Create
   repository**. Leave it empty.

### Step 2: Push the code (and starter data) to GitHub

From the folder containing `app.py`, `wsgi.py`, `Procfile`, `requirements.txt`,
`index.html`, `static/`, `data/`, etc.:

```
git init
git add .
git commit -m "Initial upload"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/tesda-assessment-scheduler.git
git push -u origin main
```

(Or use GitHub Desktop: **Add local repository** → **Publish repository** →
make sure **Keep this code private** is checked.)

Note that `data/assessments.json`, `data/representatives.json`,
`data/settings.json`, and `data/task_status.json` **are committed** —
that's intentional here, since this repo *is* your database.

### Step 3: Create the Render web service

1. On [render.com](https://render.com), click **New +** → **Web Service**
   and connect the repo you just created.
2. Fill in:
   | Field | Value |
   |---|---|
   | **Branch** | `main` |
   | **Runtime** | `Python 3` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `gunicorn wsgi:app --bind 0.0.0.0:$PORT` |
   | **Instance Type** | **Free** is fine (see architecture note above) |
3. Under **Advanced**, add one environment variable:
   | Key | Value |
   |---|---|
   | `MIRROR_MODE` | `true` |

   Do **not** set `APP_DATA_DIR` here — leaving it unset is what makes the
   app read its data from the committed `data/` folder each deploy.
4. Click **Create Web Service**. Render builds and deploys; watch the
   **Logs** tab. When it settles, your read-only mirror is live at the
   `.onrender.com` URL. You should see the orange "read-only mirror" banner
   across the top when you open it — if you don't, double check the
   `MIRROR_MODE` environment variable is set exactly to `true`.
5. Check **Settings → Build & Deploy** and confirm **Auto-Deploy** is **Yes**,
   so future pushes update the mirror automatically.

> **Free plan note:** Render's free web services spin down after 15 minutes
> idle and take about a minute to wake back up on the next visit. Since this
> is just a viewing mirror, that's a reasonable trade for $0/month. If that
> delay bothers you, Starter (~$7/month) removes it — no disk needed either
> way.

---

## Part B — Everyday use

### Running the app on your own computer

Double-click:
- **Windows:** `scripts\0_Run_App_Locally.bat`
- **Mac:** `scripts/0_Run_App_Locally.command` (first time: right-click →
  **Open** to bypass the unverified-developer warning)

This installs dependencies and starts the app. Once the window shows
`Running on http://127.0.0.1:5050`, open that address in your browser. Keep
the window open while you use the app; closing it stops the app. This is
where all real work happens — adding assessments, checking off tasks,
uploading Excel files.

### Sending your changes to GitHub (and the live mirror)

Double-click **`push_to_github.bat`** (Windows). It will:
1. Show you what changed.
2. Ask for a short commit message.
3. Commit and push everything — code and data — to GitHub.

Render picks this up automatically and redeploys the mirror within a couple
of minutes.

### Getting everyone else's latest changes

Double-click **`pull_from_github.bat`** (Windows) before you start working,
every time. This matters more here than in a typical code repo, because it
also pulls the latest **data** — someone else's new assessments or checklist
ticks.

*(Mac/Linux users: run the equivalent commands via `push_to_github.ps1`'s
logic through PowerShell Core, or just use `git pull` / `git add -A && git
commit -m "..." && git push` directly, or GitHub Desktop.)*

### If something goes wrong

- **Push fails / conflict:** someone else pushed first. Run
  `pull_from_github.bat`, then try pushing again. If two people edited the
  same assessment, this can produce a real conflict inside a `.json` file —
  don't guess at resolving it by hand; ask for help, or use GitHub Desktop's
  conflict UI.
- **Because data now lives in git, treat one clear "editor of record" as the
  norm rather than many people editing simultaneously.** JSON merge
  conflicts are much harder for a non-technical person to untangle than a
  typical code conflict. If your team is more than one or two people
  actively entering data, it's worth having a quick habit: pull right
  before you start, push right when you finish, don't leave changes
  sitting uncommitted for long.

---

## Updating Excel data

Do this **locally**, the same way as any other change: run the app on your
computer (`0_Run_App_Locally`), go to **Settings / Data Sources → Upload**,
upload the new file, then push. Uploading Excel files directly on the
Render mirror won't work as a way to update the shared data — anything
entered there is lost on the next deploy, which is exactly what the banner
warns about.

---

## Troubleshooting

- **"The mirror doesn't show my latest changes."** Check Render's **Logs**
  tab to confirm the latest deploy succeeded, and confirm Auto-Deploy is on.
- **"The mirror is missing the banner / lets me add data."** Check the
  `MIRROR_MODE` environment variable on Render is set to `true` (Settings →
  Environment).
- **"Render says the build failed."** Check the **Logs** tab for the actual
  Python error — usually a typo in `requirements.txt` or a syntax error in
  code that was just pushed.
- **"Double-clicking the `.command` file on Mac just opens it in a text
  editor."** The executable bit didn't survive the transfer. Once: open
  **Terminal**, type `chmod +x ` (with the trailing space), drag the file
  into the window, and press Enter. After that it double-clicks normally.
- **"push_to_github.bat says no origin remote."** The repo wasn't connected
  to GitHub yet — see Part A, Step 2, or run:
  `git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git`
