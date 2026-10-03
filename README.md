# AwayAgent

> **Setting up a device or handing this over? Follow [docs/SETUP.md](docs/SETUP.md)** — it is the complete, step-by-step guide (and lists the old instructions that no longer apply).

Drive `claude` sessions on your own machines from any browser.

```
browser ──► away-agent.vercel.app (static UI)
                │  login, reads, commands
                ▼
           Supabase (Postgres · Realtime · Storage · Auth)   ← always on
                ▲  outbound only
      ┌─────────┴─────────┐
   engine (this Mac)   engine (other device)   ← runs `claude -p` locally
```

- **Hub** (Vercel + Supabase): always available. Sessions, transcripts and screenshots are mirrored here, so history stays readable when every device is off.
- **Engine** (`engine/`): runs on each device, picks up commands, runs `claude`, streams output back. Devices never accept inbound connections.
- A session only runs on the device that holds its transcript. Other devices see it read-only.
- The hub keeps full transcripts for 30 days of inactivity, screenshots for sessions active in the last 24 h, and caps very long tool output at 8,000 characters.

## Your login (once)

1. Supabase dashboard → Authentication → Users → **Add user** (email + password, tick *Auto Confirm User*).
2. `npm run hub:grant-owner -- you@example.com`

Sign-ups are disabled; accounts not granted this way see nothing.

Logging in requires a 2FA code, and **only one device can be signed in at a time** (first login wins). Signing out frees the slot; so does 10 minutes of inactivity. If the signed-in device is lost: `npm run hub:release-login -- you@example.com`.

## Add a device

Requires Node 20+, the `claude` CLI logged in, and the Supabase CLI logged in (`supabase login`).

```bash
git clone https://github.com/joshghal/away-agent-webapp.git && cd away-agent-webapp
git switch supabase-hub
npm install
supabase link --project-ref mackvljdwhhpeibbvmfe
npm run engine:setup          # creates this device's own login; password goes to the Keychain
npm run engine:service -- install   # macOS: start at login, restart on crash
```

On Linux/Windows, run `npm run engine` under systemd, pm2 or tmux instead of `engine:service`.

## Daily commands (macOS)

| Command | Does |
|---|---|
| `npm run engine:service -- status` | Is the engine running? |
| `npm run engine:service -- stop` | Stop it (cleanly stops its `claude` sessions); starts again at next login |
| `npm run engine:service -- start` | Start it again |
| `npm run engine:service -- logs` | Follow the log (`~/Library/Logs/away-agent-engine.log`) |
| `npm run engine:service -- uninstall` | Remove the service entirely |

## Web app

```bash
npm run dev                 # local UI against the hosted hub (needs .env.local)
vercel deploy --prod        # publish to away-agent.vercel.app
```

`.env.local` holds only public values: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

## Database

Schema lives in `supabase/migrations/`. Apply new migrations with `supabase db push`.
