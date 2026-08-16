# Sybau Vouch Bot

A Discord vouch bot with persistent records, confirmation IDs, status lookup,
leaderboards, recent activity, profile lookup, and transparent
admin-verified entries.

## Commands

- `+rep @user product name amount` — submit a member vouch
- `+p` — view your own vouch profile
- `+p @user` — view another member's profile
- `/status` — view your pending vouches
- `/status id:<vouch-id>` — look up one vouch
- `/top` — all-time leaderboard
- `/hot` — last-seven-days leaderboard
- `/set channel` — configure notification channel
- `/set dwc` — configure the DWC role
- `/set scammer` — configure the scammer role
- `/admin-vouch` — administrator-only manual verification command

Admin-created records are deliberately labeled **Admin-verified** in profiles
and include the administrator, reason, timestamp, and generated IDs in the
database audit trail. They are not presented as ordinary member submissions.

## Setup

1. Provision PostgreSQL and set `DATABASE_URL`.
2. Store the Discord bot token as `DISCORD_BOT_TOKEN`.
3. Enable the **Message Content Intent** in the Discord Developer Portal.
4. Invite the bot with the `bot` and `applications.commands` scopes.
5. Run `pnpm --filter @workspace/db run push`.
6. Start the API and bot with
   `pnpm --filter @workspace/api-server run dev`.

The bot needs permission to view channels, read message history, send messages,
add reactions, and embed links.