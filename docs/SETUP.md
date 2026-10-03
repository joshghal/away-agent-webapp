# AwayAgent — Setup & Handover Guide

Everything needed to install AwayAgent on a new device, run it day to day, and fix common problems. Written to be followed top to bottom by a person or an AI agent with no prior context.

---

## 0. Read this first (especially if you are an AI agent)

AwayAgent was rewritten. Old instructions you may find — in chat history, the `main` branch, or an old `.env` — **no longer apply**. Do not do any of the following:

| Don't | Why |
|---|---|
| Use the `main` branch | `main` is the old Tailscale version. The current code is on **`supabase-hub`**. |
| Set `AUTH_PASS` or create a `.env` with it | That was the old Basic Auth password. Nothing reads it anymore. |
| Install or start Docker, or run `supabase start` | Docker only powers an optional *local test database*. Devices never need it. |
| Run `npm run dev` / `server.ts` to "host" AwayAgent | The website is hosted on Vercel. A device only runs the **engine**. |
| Turn on Tailscale for AwayAgent | Not used anymore. |
| Reuse another device's `.env.engine`, engine id, or password | Each device must register itself. An engine refuses to run on a different machine. |
| Commit `.env.engine`, `.env.local`, or any key | They're gitignored; keep it that way. |

---

## 1. How it works (one minute)

```
 phone / any browser
        │  https://away-agent.vercel.app   (login: email + password + 2FA code)
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Supabase project "away-agent" (ref mackvljdwhhpeibbvmfe)      │  ← always on
 │  Auth · Postgres (sessions, transcripts, commands) · Realtime │
 │  · Storage (screenshots)                                       │
 └──────────────▲───────────────────────────────▲───────────────┘
                │ outbound only                 │ outbound only
     ┌──────────┴──────────┐         ┌──────────┴──────────┐
     │ engine: device A    │         │ engine: device B    │   ← runs `claude -p`
     │ (its own Claude     │         │ (its own Claude     │     on that machine's
     │  login + MCP config)│         │  login + MCP config)│     files
     └─────────────────────┘         └─────────────────────┘
```

- **Website** (`app/`, `components/`, `lib/client/`) — static Next.js app on Vercel. No server code, no secrets.
- **Hub** (Supabase) — stores sessions and transcripts, relays commands and live output. Readable even when every device is off.
- **Engine** (`engine/`, reusing `lib/server/`) — a background program on each device. Connects *out* to Supabase, runs `claude`, streams output back, mirrors transcripts up. Nothing connects *in* to a device.
- A session runs only on the device that started it (`claude --resume` needs the local transcript). Other devices see it read-only.
- Each device has its **own Claude login** (decides which subscription pays) and its **own MCP servers**.

---

## 2. Add a new device

Target: macOS (Apple Silicon or Intel). Linux works too — see step 2.7.

### 2.1 Prerequisites

Check each; install what's missing.

```bash
node --version      # need v20 or newer   → brew install node
git --version       #                     → xcode-select --install
claude --version    # Claude Code CLI     → brew install --cask claude-code
supabase --version  # Supabase CLI        → brew install supabase/tap/supabase
```

You also need:
- Access to the **Supabase account that owns the `away-agent` project** (the setup script uses it to create this device's login).
- The **Claude account this device should use** (work or personal).

### 2.2 Get the code (on the right branch)

If an earlier attempt exists, move it aside first (`mv ~/away-agent-webapp ~/away-agent-webapp.old`).

```bash
cd ~
git clone https://github.com/joshghal/away-agent-webapp.git
cd away-agent-webapp
git switch supabase-hub
git log --oneline -1          # sanity check: you should NOT see server.ts in `ls`
npm install
```

### 2.3 Connect to the Supabase project

```bash
supabase login                                   # opens a browser; sign in with the owning account
supabase link --project-ref mackvljdwhhpeibbvmfe # if asked for a database password, press Enter to skip
```

Expected: `Finished supabase link.` (Linking is only used to look up the project's keys during setup.)

### 2.4 Sign this device into Claude

```bash
claude auth login            # pick the account this device should bill to
claude auth status           # must show loggedIn: true and the expected email
```

This login is shared by everything on this machine that uses Claude Code (VS Code, terminal).

### 2.5 Register the device

```bash
npm run engine:setup
# optional: choose the id yourself (lowercase, a–z 0–9 -):
# npm run engine:setup -- --id home-mac
```

Expected output:
```
Engine "<id>" registered.
Password stored in Keychain (away-agent-engine / <id>).
Start it with: npm run engine
```

What it did: created this device's own account (`engine-<id>@awayagent.invalid`), added it as an engine member, saved a random password in the macOS Keychain, and wrote `.env.engine` (public values only). Use a **different id on every device**.

### 2.6 Run it in the background (macOS)

```bash
npm run engine:service -- install
npm run engine:service -- status     # → "Installed, running (pid …)"
npm run engine:service -- logs       # Ctrl+C to stop watching
```

In the log you should see, within ~10 seconds:
```
engine "<id>" online (<Computer Name>, fingerprint <16 hex chars>)
mirroring N session(s)…
mirror up to date
```

It now starts automatically at login and restarts if it crashes.

### 2.7 Linux / Windows

`engine:service` is macOS-only. Instead keep `npm run engine` running under systemd, pm2, or tmux. On non-macOS, `engine:setup` stores the password in `.env.engine` (file mode 600) instead of a keychain.

### 2.8 Verify from the website

1. Open https://away-agent.vercel.app and log in (email, password, 6-digit 2FA code).
2. In the sidebar the new device appears as its own group with a green dot, e.g. `Joshua's MacBook Pro · Apple M1 Max - dbed…846d`, and a line `Claude: you@example.com · plan`.
3. Click **New session** → pick the new device under "Run on" → choose a folder → send "say hi". A reply means the device works end to end.

---

## 3. Day-to-day (macOS)

| Want to… | Run (in the repo folder) |
|---|---|
| Check the engine | `npm run engine:service -- status` |
| Stop it ("I'm home") | `npm run engine:service -- stop` — stops its Claude sessions cleanly; starts again at next login |
| Start it again | `npm run engine:service -- start` |
| Watch the log | `npm run engine:service -- logs` (file: `~/Library/Logs/away-agent-engine.log`) |
| Remove auto-start entirely | `npm run engine:service -- uninstall` |
| Get the latest code | `git pull` then `npm install` then `npm run engine:service -- stop && npm run engine:service -- start` |

In the website, each device's **Manage** button (on its sidebar header) shows that device's Claude login and MCP servers. Changing them requires the device to be online.

---

## 4. Logging in to the website

- **First login**: email + password → scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy) → enter the 6-digit code. Delete any old `localhost:3000` entry from the authenticator app.
- **Later logins**: email + password + 6-digit code.
- **One device at a time**: only one browser can be signed in per account (first login wins). Another device sees "already signed in on …". Sign out there, or wait — an idle login frees itself after **10 minutes**.

---

## 5. Owner / admin tasks

Run from the repo folder on a machine where `supabase login` + `supabase link` are done.

| Task | How |
|---|---|
| Create your website account | Supabase dashboard → project away-agent → Authentication → Users → **Add user** (tick *Auto Confirm User*), then `npm run hub:grant-owner -- you@example.com` |
| Free the single-login slot now (lost device) | `npm run hub:release-login -- you@example.com` |
| Lost your 2FA phone | Dashboard → Authentication → Users → your user → remove the MFA factor; re-enroll at next login |
| Remove a device | Stop/uninstall its engine; dashboard → Authentication → Users → delete `engine-<id>@awayagent.invalid`; delete its row in `public.engines` |
| Re-register a device (new id) | `npm run engine:setup -- --id <new-id>` then reinstall the service |
| Deploy website changes | `vercel deploy --prod` (Vercel CLI logged in; project already linked in `.vercel/`) |
| Apply database changes | add a file in `supabase/migrations/`, then `supabase db push` |

Never put the Supabase **service-role / secret key** on Vercel or in any engine. Scripts fetch it on demand from your Supabase CLI login.

---

## 6. Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| Asks for `AUTH_PASS`, mentions `server.ts`, or tries to build Docker | You're on old code. `git switch supabase-hub` (or re-clone per 2.2). |
| `No linked Supabase project — run supabase link …` | Run step 2.3 in the repo folder. |
| `engine setup failed: … api-keys …` | `supabase login` with the account that owns the project, then retry. |
| Log: `sign-in failed … Email logins are disabled` | Supabase email provider got switched off. Dashboard → Authentication → Sign In / Providers → enable Email (keep **sign-ups disabled**). |
| Log: `is not an AwayAgent member` | Re-run `npm run engine:setup` (it re-grants membership). |
| Log: `registered to a different machine (fingerprint …)` | That engine id belongs to another computer (e.g. a copied `.env.engine`). Run `npm run engine:setup -- --id <unique-id>`. |
| Log: `No engine password found` | Keychain entry missing → re-run `npm run engine:setup`. |
| Device shows **Offline** in the sidebar | `npm run engine:service -- status`; if not running → `start`; then read `logs`. |
| Device header shows **Claude login needed**, or no `Claude:` line | Run `claude auth login` on that device (or use **Fix** in the website while it's online). The header updates within 5 minutes or on engine restart. |
| "Open in another app right now — read-only here" | That session is being written by another program (e.g. VS Code). Start a new session, or wait until it's idle a minute. |
| Website: "already signed in on …" | Single-login rule. Sign out on the other device, wait 10 min, or `npm run hub:release-login`. |
| Website: "This account isn't authorized" | Account exists but isn't granted: `npm run hub:grant-owner -- <email>`. |
| Website shows an old layout | Hard reload (Cmd+Shift+R) or reopen the tab. |
| First reply after an engine restart is slow | Expected for a few seconds. If a turn stalls, the log prints `stall: Ns with no output…`. |

---

## 7. Reference

### Repository layout
```
app/, components/, store/, lib/client/   website (deployed to Vercel)
lib/shared/ws-protocol.ts                 message types shared by website and engine
lib/server/                               session runtime reused by the engine (spawn, kill, transcripts)
engine/index.ts                           the engine
engine/setup.ts                           npm run engine:setup
engine/service.ts                         npm run engine:service -- install|start|stop|status|logs|uninstall
engine/grant-owner.ts, release-login.ts   owner tools
engine/mirror.ts                          transcript → Supabase mirroring
supabase/migrations/                      database schema and security rules
```

### npm scripts
| Script | Purpose |
|---|---|
| `engine` | Run the engine in the foreground |
| `engine:setup [-- --id X]` | Register this device |
| `engine:service -- <cmd>` | macOS background service |
| `hub:grant-owner -- <email>` | Give an account website access |
| `hub:release-login -- <email>` | Free the single-login slot |
| `dev` / `build` | Local website development / build (not needed on devices) |

### Files that stay on each device (never committed)
| File / place | Contains |
|---|---|
| `.env.engine` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ENGINE_ID`, `ENGINE_EMAIL` (public values; on Linux also `ENGINE_PASSWORD`) |
| macOS Keychain `away-agent-engine / <id>` | the engine's password |
| `~/Library/LaunchAgents/com.awayagent.engine.plist` | the background service |
| `~/.claude/` | Claude Code's own login and transcripts (the originals) |

### Security model (summary)
- Website login requires password + TOTP 2FA, and only one active login per account.
- Database rules (RLS): owners see everything only with 2FA + the login slot; each engine can read shared session data but write only its own rows, read only its own command inbox, and cannot send commands.
- Live output travels on a per-device private channel (`engine:<id>`) that only that device can send to and only the owner can read; `presence` carries only online status.
- One-time Claude login codes are validated, used once, and blanked in the database right after.
- Engines connect outbound only; no ports are opened on any device.
