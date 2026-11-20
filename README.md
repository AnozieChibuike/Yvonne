# Yvonne

Yvonne is a personal assistant that runs on WhatsApp. It uses Groq for chat and voice-note transcription, Supabase for Yvonne tasks/preferences/check-in settings, and can keep Google Tasks available as a separate task provider.

## What it can do

- Chat naturally over WhatsApp, restricted to the numbers and LIDs in `ALLOWED_NUMBERS`.
- Create, list, complete, and delete Supabase tasks; explicitly request Google Tasks to use that separate provider.
- Transcribe incoming WhatsApp voice notes and reply with text.
- Create, list, and cancel one-time reminders and alarms; explicitly requested daily or weekly reminders repeat.
- Send overdue reminders after a VPS restart, with the original scheduled time included.
- Ask before saving profile answers or suggested memories; only confirmed memories are included in future context.
- Send morning, daytime, and evening check-ins using each user's saved local time and timezone.
- Add capabilities through the assistant tool registry without putting integrations into the WhatsApp message handler.

## Requirements

- Node.js 20 or newer.
- A Groq API key.
- A Supabase project.
- A WhatsApp account to link as a device.
- An always-on host for proactive check-ins. A VPS is recommended.

## Configure

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set `GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and comma-separated `ALLOWED_NUMBERS`. Use international digits for phone numbers; include `@lid` for a WhatsApp LID. Keep `.env` private; never paste credentials into chat or commit them.
3. In the Supabase SQL editor, run [`supabase/migrations/20261120100000_yvonne.sql`](./supabase/migrations/20261120100000_yvonne.sql) followed by [`supabase/migrations/20261120114500_reminders_and_memory.sql`](./supabase/migrations/20261120114500_reminders_and_memory.sql). These create the tasks, preferences, check-in, reminder, profile, and memory tables with row-level security enabled.
4. Configure `CHECKIN_TIMEZONE` and the morning/daytime/evening times. Defaults are `Africa/Lagos`, `07:00`, `13:00`, and `21:00`. Yvonne seeds these defaults only for check-in types that do not already have saved settings.
5. Start Yvonne:

   ```sh
   npm start
   ```

6. Scan the printed QR code from WhatsApp → Linked devices. Keep the process running on the VPS; the check-in scheduler runs inside it.

The Supabase service-role key bypasses row-level security, so it must remain on the server and must never be embedded in a client app. Yvonne rejects startup unless at least one sender is configured in `ALLOWED_NUMBERS`; all other senders are rejected.

The default chat model is `openai/gpt-oss-120b`. Set `GROQ_MODEL` to another model ID returned by your Groq account's `GET /openai/v1/models` endpoint if you prefer a different model.

## Google Tasks (optional)

To keep Google Tasks available as a separate provider, configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run:

```sh
npm run auth
```

Follow the terminal prompts to create the local `token.json`. Google Tasks is not mirrored to Supabase. Use `!google ...` commands or explicitly ask Yvonne for Google Tasks. The existing Google task-list selection commands are available as `!google lists` and `!google use <number>`.

## WhatsApp commands

| Command | Action |
| --- | --- |
| `!help` | Show help |
| `!tasks` | List open Supabase tasks |
| `!add <title> \| <notes>` | Add a Supabase task |
| `!done <number or id>` | Complete a listed Supabase task |
| `!delete <number or id>` | Delete a listed Supabase task |
| `!google tasks` | List Google Tasks |
| `!google add <title>` | Add a Google task |
| `!google done <number or id>` | Complete a Google task |
| `!google delete <number or id>` | Delete a Google task |
| `!google lists` / `!google use <number>` | Browse and select a Google task list |

Reminders and alarms use `Africa/Lagos` local time by default. Ask Yvonne naturally, for example: “Remind me tomorrow at 9 am to call Mum,” “Set an alarm for 6:30 tomorrow,” or “List my reminders.” Ambiguous dates or times should be clarified before saving. One-time delivery is the default; specify a repeat schedule for recurring reminders. `!reminders` lists scheduled alerts. If Yvonne is offline at the scheduled time, it sends the overdue alert after reconnecting and includes the original time.

Yvonne starts a short onboarding after your first interaction; each answer is staged and saved only after you confirm it. Use `!skip` to stop or `!onboard` to start again. You can also ask naturally, for example: “Remember that I prefer short meetings,” “Add a task to renew my passport,” or “Move my evening check-in to 9:30 pm.” Supabase is the default task provider; Google Tasks stays separate.

## Adding a tool

Register a tool in `src/assistant/tools.js` with a JSON-schema function definition and an async handler. The handler receives its arguments and a `{ userJid }` context. Keep provider/service logic out of `src/whatsapp/handler.js`; that module should remain the channel adapter.

## Running and testing

```sh
npm start
npm test
```

Use a process manager such as systemd or PM2 on the VPS so Yvonne restarts after host reboots. Preserve `auth_info_baileys/` and `token.json` securely between restarts; they contain credentials/session data and are ignored by Git.

The repository includes a systemd unit at [`deploy/yvonne.service`](./deploy/yvonne.service). It runs as a dedicated `yvonne` service user, loads `/opt/yvonne/.env`, and restricts writes to the app directory. On first start, follow `journalctl -u yvonne -f` and scan the WhatsApp QR code; the new VPS session is stored in `/opt/yvonne/auth_info_baileys/`.
