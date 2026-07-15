# MythicCall — WhatsApp-style MVP

Real-time 1:1 messaging app: Node/Express + Socket.io + SQLite backend, React frontend.

## Features
- Name-only login (no password), unique names enforced
- 1:1 and group real-time messaging (Socket.io)
- Message persistence (SQLite)
- Online/offline presence, typing indicators
- Message reactions (emoji)
- Reply to messages
- Read receipts / delivery ticks (✓ sent, ✓✓ delivered, ✓✓ blue read)
- Image, file, and voice note sharing (hold the mic button to record)
- Delete your own messages
- In-chat message search
- WhatsApp-style dark theme with per-person avatar colors

## Database: Supabase setup (required)

The backend now uses Supabase (Postgres + file storage) instead of local SQLite, so your data survives server restarts.

1. Go to **supabase.com**, sign up, click **New Project** (free tier is fine)
2. Once created, go to **SQL Editor → New query**, paste the contents of `server/supabase-schema.sql`, click **Run**
3. Go to **Project Settings → API**, copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not the anon key) → this is `SUPABASE_SERVICE_KEY`
4. Add both as environment variables on your Render service (Settings → Environment):
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_KEY` = your service role key
   - `JWT_SECRET` = any random string (optional but recommended)
5. In Supabase: **Storage → uploads bucket** should already exist from the SQL script and be public, so uploaded images/files are viewable.

## Offline push notifications (optional but recommended)

To get notified even when the app/browser is fully closed, add these two Render environment variables:

- `VAPID_PUBLIC_KEY` = `BEo3_JMnb684qqG9IM3dpEDuDy4w0pn4og4FLB9ofjn74M09PiwlDZ-10maseptALc_a_jxIC_VO9AV6QdanJuo`
- `VAPID_PRIVATE_KEY` = `r7m8Eb2RrVk5qYU32sO5NToSuEaB_R1PqrY9J36rI8E`

Also run the updated `server/supabase-schema.sql` again in Supabase's SQL Editor (it's safe to re-run — it only adds the new `push_subscriptions` table, nothing existing is touched).

Once set, open the app, go to Settings → Enable notifications. You'll now get real system notifications even with the browser fully closed, as long as your phone/laptop is on and connected to the internet.

## Email login (required)

Login now works by emailing a 6-digit code — no passwords. This needs a [Resend](https://resend.com) account (free tier is plenty for testing):

1. Sign up at resend.com and go to **API Keys** → create one.
2. Add this Render environment variable:
   - `RESEND_API_KEY` = your key (starts with `re_`)
3. (Optional) By default, emails send from `onboarding@resend.dev`, which works immediately with no setup but can only be sent reliably in small volume / for testing. For a real launch, verify your own domain in Resend under **Domains**, then set:
   - `EMAIL_FROM` = `MythicCall <login@yourdomain.com>`
4. Run the updated `server/supabase-schema.sql` again in Supabase (adds the new `email_codes` table — safe to re-run).

Test it: enter your email on the login screen, check your inbox (and spam folder) for the code, enter it, and you're in. First time with a given email, it'll also ask for a display name.

## Setup

### 1. Backend
```bash
cd server
npm install
npm run dev
```
Runs on `http://localhost:4000`. Creates a `chat.db` SQLite file automatically.

### 2. Frontend
In a new terminal:
```bash
cd client
npm install
npm run dev
```
Runs on `http://localhost:5173`.

### 3. Try it
- Open `http://localhost:5173` in two different browser windows (or one normal + one incognito).
- Register two different accounts.
- Click "+ New chat" → pick the other user → start messaging in real time.

## Project structure
```
chatapp/
  server/
    index.js       # Express + Socket.io server, all API + realtime logic
    db.js           # SQLite schema
    package.json
  client/
    src/
      App.jsx        # Root component, session state
      Auth.jsx        # Login/register screen
      ChatList.jsx    # Sidebar chat list
      ChatWindow.jsx  # Message thread + input
      Contacts.jsx    # Modal to start new chats
      api.js          # REST + socket client
      styles.css
    package.json
```

## Next steps to make this production-ready
1. **Move JWT_SECRET to an environment variable** — never hardcode secrets.
2. **Add end-to-end encryption** — look at the Signal Protocol (libsignal) for the standard approach.
3. **Group chats** — schema already supports `is_group`; add a "create group" UI flow.
4. **Media messages** — add object storage (S3/Cloudflare R2) + upload endpoint, extend `messages` table with a `media_url`/`type` column.
5. **Push notifications** — Firebase Cloud Messaging for background delivery when the app isn't open.
6. **Message delivery/read receipts** — extend the `status` field (sent → delivered → read) and emit socket events on receipt.
7. **Mobile app** — port the React components to React Native; the backend and API layer need no changes.
8. **Swap SQLite for Postgres** when you need to scale past a single server.
9. **Rate limiting & input validation** on the API routes before deploying publicly.
