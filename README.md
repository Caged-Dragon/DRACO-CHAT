# 🐉 Dragon Chat (v5.5)

> ### Shared Supabase project: CAGED_DRAGON
> Dragon Chat runs on the **CAGED_DRAGON** Supabase project (`gbeurqibcfvquacasofq`), which is
> shared with other Caged Dragon products (webhub, store, mail, gamehub, ...).
> - `supabase/schema.sql` only touches Dragon Chat's own 20 tables. **Never** add statements that
>   cover `all tables in schema public` - they would change access for the other apps.
> - **Do not deploy `delete-account` as-is.** It deletes the auth user, which on a shared project
>   would delete the person's account in every other Caged Dragon product. It needs a chat-only
>   variant first (the Delete Account button will show an error until then).
> - `send-push` is deprecated; push is sent by the `notify-message` function.
> - Deployed already: `notify-message`, `cleanup-storage` (both `--no-verify-jwt`).
> - Still to set by hand: VAPID secrets, Auth URL configuration (see below).

*Connect Different. Chat Real.*

A full-featured, installable chat web app: 1:1 and group messaging,
voice/video calling (1:1 and group), presence, reactions, per-user
theming, status/stories, and more. Built by **Caged Dragon Studios**.

**Stack:** React + Vite (frontend) · Supabase (auth, database, realtime, storage) · GitHub + Vercel (hosting)

---

## v5.11 — Safety, privacy and reliability

**People & safety**
- **Admin report review:** admins get *Settings → Account & privacy → Admin: review reports* — see who reported whom, the
  reason and the reported message, add a private note, **dismiss / resolve / resolve + suspend**, and un-suspend. Suspended
  accounts can still read but cannot send messages, friend requests or statuses.
  Make yourself the first admin (Supabase SQL Editor): `update public.profiles set is_admin = true where username = 'YOUR-USERNAME';`
- **Two-step verification** (authenticator app) in Settings, plus a code screen at sign-in. It is **enforced by the database**:
  an account with it turned on can't read or write anything with a password-only session. (Check *Authentication → Multi-Factor* is enabled in Supabase.)
- **Download my data** (JSON) in Settings.
- **Fix for brand-new projects:** `schema.sql` now strips Supabase's default table-level rights on `profiles` so users can
  only edit their own username, avatar, status and presence (previously a fresh install would have let a user edit `is_admin`).

**Reliability & speed**
- **Offline message queue:** messages (text, GIFs, photos, voice) are saved on the device and delivered automatically when the
  connection returns; failed ones show "Not sent" with Retry / Delete. Group chats no longer silently drop a failed message.
- **Photos are compressed before upload** (max 1600 px; avatars 512 px), saving data and storage.
- **"New version available" banner** with a one-tap reload.
- Group calls: fixed a race that could leave one link stuck "connecting"; stuck links are now rebuilt after 20 s.

**Accessibility:** pop-ups are real dialogs (focus moves in and is trapped, Escape closes, focus returns); labelled controls,
page landmarks, heading order, visible keyboard focus, and AA text contrast on the default theme (checked with axe-core).

**Automated checks:** `.github/workflows/ci.yml` runs unit, layout, accessibility, feature and real-WebRTC call tests on every
push (needs GitHub Actions enabled); `.github/dependabot.yml` opens weekly dependency-update PRs.
Locally: `npm run test:all` (needs `pip install playwright pillow` and `python -m playwright install chromium`).

## v5.10 — Better calling

**Reliability**
- **Reconnects dropped calls:** if the network blips (wifi↔mobile data), the call shows "Reconnecting…" and
  automatically restarts the connection (ICE restart) — up to 3 tries, with a manual "Try again" button.
  If it can't recover, the call ends with a clear message *and the other person is told*.
- **TURN relay support:** `VITE_TURN_URL` now accepts several comma-separated URLs
  (`turn:host:3478?transport=udp,turn:host:3478?transport=tcp,turns:host:443?transport=tcp`).
  A TURN relay is strongly recommended: many mobile/corporate networks can't make direct connections.
- Faster start (candidate pre-gathering), 25 s connect timeout, offline pre-check, busy-line reply
  ("X is on another call"), and call errors ("No answer", "declined", permission denied) are now actually shown.

**Quality**
- Microphone: echo cancellation, noise suppression and auto-gain requested; Opus tuned with
  in-band FEC + DTX (mono, 32 kbps cap) so voice survives packet loss and uses little data.
- Video: resolution/frame-rate/bitrate chosen from the network (phone data vs wifi), motion kept smooth;
  screen share keeps text sharp.
- **Signal indicator** (green/yellow/red bars) from live stats; on a poor connection video is **paused
  automatically** to keep the audio clear and resumes when the link recovers.

**Experience**
- Ringtone, ringback tone, vibration, connect/hang-up cues (generated in code, no audio files);
  system notification for an incoming call when the tab is in the background.
- Screen stays awake during calls; live microphone level ring on the mute button.
- Flip camera, choose microphone / camera / speaker mid-call; see when the other person is muted or
  has their camera off.
- **Group calls:** fixed — *voice-only group calls played no sound*; per-person "Reconnecting…", mute icons,
  video quality drops as the room fills, capped at 6 people (mesh), responsive tile grid.

**Tests:** `npm run test:calls` runs two end-to-end suites in a real browser with real WebRTC and fake
devices (1:1 calls: 39 checks; group calls: 14 checks). Unit tests: `npm test`.

## v5.9 — Responsive, mobile-first layout

- New `src/layout.css` (loaded after `styles.css`): the **phone layout is the base**; `min-width`
  queries add the tablet (768px+ — sidebar and chat side by side) and desktop (1100px+/1500px+ —
  wider sidebar, centred conversation column) layouts. Safe-area insets, `100dvh`, and 16px inputs
  (no iOS zoom) are handled.
- Fixed the real causes of overlapping components: flex children squashing into each other
  (sidebar, modals), message toolbars floating over neighbouring bubbles (they now open on **tap**
  on touch screens, in flow above the bubble), modals launched from the sidebar hiding behind the
  chat on tablets/desktops, and ~18 components that had no CSS at all (GIF picker, pinned banner,
  @mention list, forward list, global search results, ...).
- Modals are bottom sheets on phones and centred cards from 600px up.
- Removed the JavaScript-measured inline-style hacks from the dashboard and chat windows.
- `tests/ui/` renders the app in a headless browser at 14 screen sizes and fails on any overlap
  or sideways scrolling (see `tests/ui/README.md`).

## v5.8 — Features, server-side push, clean-up

**New in the app**
- **Mute & archive** chats and groups (⋮ menu). Muted chats don't count toward the
  tab title / app-icon badge and send no push; archived chats move to a collapsible section.
- **Group unread badges** plus an app-icon badge (where the browser supports it).
- **Group admins:** make/remove admins, add friends to an existing group, remove
  members, leave a group (creator can delete it).
- **Load earlier messages** (50 at a time) in direct and group chats, and **search across the
  whole conversation** (not just what's loaded).
- **Delete my account** (Settings) — removes the profile, messages and uploaded files.
- **GIF picker now uses GIPHY** (Tenor's API was shut down). Set `VITE_GIPHY_API_KEY`;
  without it the GIF button is hidden.
- Live group messages now show the sender's name immediately.
- Smaller first load: modals are lazy-loaded, vendor chunks split, offline cache cut from ~3.2 MB to ~1 MB.

**Backend**
- **Push is now sent by the database**: a trigger calls the `notify-message` edge function for every
  new message (respecting mute and blocks). The browser no longer calls `send-push` (deprecated).
- **File clean-up:** files are deleted a few minutes after their message/status/avatar is removed or expires
  (queue + `cleanup-storage` function + pg_cron). A file still used by a forwarded copy is kept.
- **Built-in error log:** uncaught client errors are saved to `public.client_errors` (30-day retention).
- Case-insensitive unique usernames; group roles enforced in the database.

**Deploying the backend (new project)**
1. Run `supabase/schema.sql`, then edit the one row it seeds in `private.app_config`
   (`functions_url` → `https://<your-ref>.supabase.co/functions/v1`).
2. `supabase functions deploy notify-message --no-verify-jwt`
   `supabase functions deploy cleanup-storage --no-verify-jwt`
   `supabase functions deploy delete-account`
3. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com`

**Tests:** `npm test` (unit tests) and `supabase/tests/rls_smoke.sql` (database rules; rolls itself back).
`npm run types` regenerates TypeScript types from the database (needs the Supabase CLI).

## v5.7 — Security & database clean-up, legal pages

- **Privacy Policy** (`public/privacy.html` → `/privacy.html`) and **Terms &
  Conditions** (`public/terms.html` → `/terms.html`) are standalone pages,
  linked from the landing page, the login/sign-up form and Settings.
  Search both files for the yellow `[CONTACT EMAIL]`, `[STUDIO ADDRESS…]`
  and `[CITY…]` placeholders and fill them in before launch.
- `supabase/schema.sql` now mirrors the live database exactly (fresh-install safe).
- Database fixes: missing v5.6 tables/columns added (`push_subscriptions`,
  `group_message_reactions`, `chat_preferences`, pins, mentions, disappearing
  messages, read markers); friend requests can no longer be forged as
  "accepted"; messages require an accepted friendship; receivers/members can
  only mark-read or pin (not edit) others' messages; nobody can self-join a
  group; user emails are hidden from other users; storage uploads are limited
  to your own folder with size/type limits and no public listing; foreign-key
  indexes added; a `pg_cron` job purges expired disappearing messages.
- `send-push` now requires a signed-in caller who is an accepted friend of the
  recipient. It needs the three VAPID secrets set (see the push section).
- The app reads its own profile with an explicit column list (the `email`
  column is no longer readable through the API — use `user.email`).

## v5.5 — Installable as a native-feeling app (PWA)

Dragon Chat can now be installed straight from the browser, no app
store needed:

- **Android / Chrome / Edge / desktop Chrome** — a branded "Install
  Dragon Chat" popup appears automatically once the browser decides
  the site is installable (usually a couple seconds after load). It
  uses the browser's real install flow under the hood
  (`beforeinstallprompt`), just with our own styled button instead of
  the generic browser banner.
- **iOS Safari** — Apple doesn't support that same install API, so
  instead the popup shows the manual steps: *tap Share, then Add to
  Home Screen*. Once added, it opens full-screen with no Safari
  address bar, exactly like a native app.
- Installed app gets a proper home-screen icon, splash behavior, and
  standalone window — no browser chrome.
- Basic **offline app-shell caching** via a generated service worker —
  the app itself will still open without a connection (though live
  data like chat, calls, and login obviously still need one).
- The popup respects the person's choice: dismiss it and it won't
  reappear for 7 days, and it never shows at all once the app is
  actually installed.

**New/changed files:** `vite.config.js` (PWA plugin config),
`index.html` (iOS meta tags), `src/components/InstallPrompt.jsx`
(new), `src/App.jsx` (renders it globally), plus generated icons in
`public/` (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
`apple-touch-icon.png`). **New dependency:** `vite-plugin-pwa` — run
`npm install` after pulling this update. No Supabase/schema changes.

---

## v5.4 — Status / Stories

New feature, like WhatsApp Status or Instagram Stories:

- A horizontal row of circular avatars at the top of the sidebar —
  "Your status" first, then any friends with an active story. A
  gradient ring means there's something new to see; a muted ring means
  you've already viewed everything that person posted.
- **Post a text status** (short message on a colored background, pick
  from 8 preset colors) or an **image status** (with an optional
  caption).
- Tap a circle to open a **full-screen viewer** with Instagram-style
  progress bars across the top, auto-advancing every 5 seconds. Tap
  the left/right edge of the screen to go back/forward; press and hold
  anywhere to pause.
- **Statuses expire after 24 hours** automatically (enforced at the
  database level — a status simply stops being visible to others past
  its `expires_at`, no cleanup job required).
- On your own statuses, tap "Viewed by" at the bottom to see exactly
  who's seen it and when, and a 🗑 button to delete a status early.

**New tables:** `statuses`, `status_views`. **New storage bucket:**
`status-media`. All covered by the usual full `supabase/schema.sql` —
re-run it (idempotent) to pick this up. No existing tables changed.

### Known limits
- Expired statuses aren't actively deleted from the database, just
  hidden by Row Level Security — fine at small scale, but a scheduled
  cleanup (e.g. a `pg_cron` job) would be a sensible addition if this
  grows.
- No "close friends" / custom audience list yet — a status is visible
  to *all* of your accepted friends, same as everyone else's.

---

## v5.3.1 patch notes

Mobile overflow issues (chat header, input row, Send button hidden)
kept resurfacing across incremental CSS patches — most likely because
manually pasted snippets left old/conflicting rules in place, and CSS
silently lets the *last* matching rule win regardless of which one is
"correct." Rather than patch the stylesheet again, chat headers and
input rows (`ChatWindow.jsx`, `GroupChatWindow.jsx`, `Dashboard.jsx`)
now compute their sizing in JavaScript from the real, live
`window.innerWidth` (via a new `useViewportWidth` hook) and apply it
as inline styles. Inline styles always win over any stylesheet rule,
so this is immune to the exact class of bug that kept recurring — it
no longer matters what state `styles.css` is in for these elements.

---

## v5.3 patch notes

- **Fixed a real overflow bug**: a CSS rule meant only for the "Send"
  button (`.chat-input button`) was also styling the emoji/attach/mic
  icon buttons as giant gradient pills, pushing Send off-screen on
  phones. The icon buttons and text input also lacked `min-width: 0`,
  which is what let the row overflow the viewport in the first place.
  Both are fixed, plus a global `overflow-x: hidden` safety net on
  `<body>` so this class of bug can't cause page-wide horizontal
  scrolling again.
- **Friend search is now live** — results appear as you type (debounced
  ~300ms), no more pressing Enter or a "Find" button.
- **Friend requests/acceptances and group invites** now have a 15-second
  polling fallback in addition to realtime, so they show up without a
  manual refresh even if realtime replication isn't active on your
  Supabase project for some reason.
- **More fluid sizing** — chat header padding, message bubbles, and
  friend list text now scale smoothly with screen width (`clamp()`)
  instead of only jumping at fixed breakpoints.

---

## v5.2 patch notes

- **Usernames are now editable** from the Profile modal (previously
  locked at signup). Renaming checks for uniqueness and shows a clear
  error ("That username is already taken") if it's in use.
- **Every account now has a permanent numeric ID** (`user_number`),
  assigned automatically by the database the moment the account is
  created, and shown in the Profile modal as a Dragon Chat ID (e.g.
  `#000123`). It never changes — even if the username is renamed —
  and a database trigger blocks it from being altered by any client
  request.

If you're upgrading from v5.1, **re-run the full `supabase/schema.sql`**
(safe, idempotent) — it backfills a `user_number` for every existing
account automatically.

---

## v5.1 patch notes

Two bugs fixed after real-world testing of v5:

1. **Group creation could fail** — a circular Row Level Security check
   meant the group creator couldn't add friends as members right after
   creating a group (their own membership row would insert fine, but
   everyone else's would be silently rejected, rolling back the whole
   insert). Fixed by letting the creator see their own group immediately
   instead of only after they're already a member.
2. **Friend requests, acceptances, and being added to a group required a
   manual page reload to show up** — `friendships` and `groups` were
   never added to Supabase's realtime publication, and the sidebar
   components had no live subscription to begin with. Both are fixed:
   the tables are now realtime-enabled, and `FriendRequests.jsx`,
   `FriendsList.jsx`, and `GroupsList.jsx` all subscribe to live changes
   instead of only refreshing on the current user's own actions.

If you're upgrading from v5.0, **re-run the full `supabase/schema.sql`**
(safe, idempotent) to pick up both fixes.

---

## Feature list

**Auth & security** — email/password + GitHub OAuth, real email
verification, forgot password, Row Level Security on every table.

**Friends** — search, real request/accept/decline flow, unfriend, block,
report.

**1:1 chat** — realtime text, image/document/voice-message attachments,
typing indicators, read receipts (✓/✓✓), message reactions, edit/delete,
reply/quote, in-chat search, clickable links, online/offline + "last seen"
presence, unread badges + document title counter.

**Groups** — create a group with any of your friends, group text chat with
attachments/typing/reply/edit/delete, group voice/video calls (mesh
WebRTC — see note below).

**Calling** — 1:1 voice/video (WebRTC + Supabase Realtime signaling, no
extra backend), call history log, mute/camera toggle, screen sharing.

**Profile** — avatar upload, status message, manual presence status
(online/away/busy/DND).

**Customization** — 12+ global theme colors with a live full-app mockup
preview, one-click Light/Dark presets, per-chat color overrides, global +
per-chat wallpaper images.

**Landing page** — animated marketing page shown before login.

---

## Known scope limits (by design, not bugs)

- **No TURN server included** — calls use free public STUN servers only.
  Works on most networks; can fail across some strict corporate/carrier
  NATs. Set `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`
  (see below) to add one from a provider like Twilio or Metered.ca.
- **Group calls are full-mesh**, not routed through a media server —
  every participant connects directly to every other participant. Fine
  for small groups (~2-6 people); bandwidth/CPU cost rises with each
  additional person.
- **Link previews are click-only**, not rich unfurled cards (no page
  title/image fetch) — that needs a backend fetcher to get around
  browser CORS restrictions, which this app doesn't have.
- **No push notifications when the app is fully closed** — calls and
  messages only reach you while the app is open in a tab (via Realtime),
  since real push needs a service worker + backend, intentionally skipped
  for now.
- **Group chat doesn't have reactions or per-member read receipts** (1:1
  chat only) — kept out to keep the group data model simpler.

---

## Complete setup guide (fresh start)

### 0. What you need
- Free accounts: **GitHub**, **Supabase**, **Vercel** (check each site's current free-tier limits).
- **Node.js 20 LTS or newer** (18 is the minimum) and **Git** installed. Check: `node -v`, `git -v`.

### 1. Get the code and install
```bash
unzip dragon-chat-v5.10.zip && cd dragon-chat
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

### 2. Create / choose your Supabase project
**Option A — reuse the existing "DracoChat" project:** the database, storage rules, scheduled jobs and the
edge functions are already installed. Skip to step 3.

**Option B — brand-new project:**
1. supabase.com → **New project** (note the **Project ref**, the `abcdefgh…` part of its URL).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**. (Safe to run again.)
   If it complains about `pg_cron` or `pg_net`, enable them under **Database → Extensions**, then run again.
3. Tell the database where your functions live (new query, use YOUR ref):
   ```sql
   update private.app_config
   set value = 'https://gbeurqibcfvquacasofq.supabase.co/functions/v1'
   where key = 'functions_url';
   ```
4. Deploy the edge functions (from the project folder):
   ```bash
   npx supabase login
   npx supabase link --project-ref gbeurqibcfvquacasofq
   npx supabase functions deploy notify-message --no-verify-jwt
   npx supabase functions deploy cleanup-storage --no-verify-jwt
   npx supabase functions deploy delete-account
   ```

### 3. Fill in `.env`
Supabase → **Project Settings → API** → copy the **Project URL** and the **anon / public** key:
```
VITE_SUPABASE_URL=https://gbeurqibcfvquacasofq.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_VAPID_PUBLIC_KEY=          # from step 4
VITE_GIPHY_API_KEY=             # optional — free key at developers.giphy.com; without it the GIF button is hidden
```
Never put the `service_role` key in `.env`. `.env` is git-ignored.

### 4. Push-notification keys (optional but recommended)
```bash
npx web-push generate-vapid-keys
npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@yourdomain.com
```
Put the **public** key in `.env` as `VITE_VAPID_PUBLIC_KEY`. Keep the private key secret.

### 5. Supabase Authentication settings
**Authentication → URL Configuration**
- **Site URL:** `http://localhost:5173` for now (change to your live URL after step 8).
- **Redirect URLs:** add `http://localhost:5173` (add the live URL later too).

**Authentication → Providers → Email:** keep **Confirm email** ON.
For real users set up your own **SMTP** (Authentication → Emails → SMTP Settings) — the built-in sender is for testing only.
Optional: **GitHub** provider (callback URL `https://gbeurqibcfvquacasofq.supabase.co/auth/v1/callback`).
Optional: enable **Leaked password protection** (Authentication → password settings; may need a paid plan).

### 6. Run it on your computer
```bash
npm run dev
```
Open http://localhost:5173. Create two accounts in two different browsers (or one normal + one private window),
confirm the emails, add each other as friends, then try: messages, a photo, a GIF, a voice call and a video call.

### 7. Put the code on GitHub
Create an empty **private** repository on github.com (no README), then:
```bash
git init
git add .
git commit -m "Dragon Chat v5.10"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
git push -u origin main
```

### 8. Deploy on Vercel
1. vercel.com → **Add New… → Project** → **Import** your GitHub repo.
2. Framework preset **Vite** (auto-detected). Build command `npm run build`, output directory `dist`.
3. **Environment Variables:** add the same variables as your `.env` (names and values).
4. **Deploy**. When it finishes you get a URL like `https://your-app.vercel.app`.
5. Back in Supabase **Authentication → URL Configuration**: set **Site URL** to that URL and add it under
   **Redirect URLs** (also add your custom domain if you connect one). No redeploy needed.
6. Changing an environment variable later needs a **Redeploy** in Vercel (they are baked in at build time).

### 9. Before sharing it with people
- Replace the yellow placeholders in `public/privacy.html` and `public/terms.html` (`[CONTACT EMAIL]`, address, city) and get them reviewed.
- Open the live site on a phone: sign up, chat, make a call (calls need HTTPS, which Vercel provides), toggle notifications, "Add to Home Screen".
- For reliable calls on mobile data add a TURN relay: set `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` in Vercel and redeploy.

### 10. Updating later
Edit code → `git add . && git commit -m "..." && git push` → Vercel redeploys automatically.
Database changes: run the new SQL in the Supabase SQL Editor (and update `supabase/schema.sql`).

### Troubleshooting
| Symptom | Fix |
|---|---|
| Blank page / "Invalid API key" | Wrong or missing `VITE_SUPABASE_*` values; on Vercel add them and **Redeploy**. |
| Confirmation / reset email sends you to `localhost` | Set **Site URL** and **Redirect URLs** in Supabase to the live URL. |
| No emails arrive | Check spam; for real use configure custom SMTP. |
| No GIF button | `VITE_GIPHY_API_KEY` missing. |
| Calls don't connect on mobile data | Add a TURN relay (step 9). |
| No push notifications | VAPID secrets not set, or notifications not allowed in the browser. |
| Edge function errors | Supabase → **Edge Functions → Logs**. |

## How it works (v5 additions)

- **Presence** — `contexts/PresenceContext.jsx` uses Supabase Realtime
  Presence on a shared `presence-global` channel; also writes
  `last_seen_at` on a heartbeat so "last seen" stays accurate.
- **Unread counts** — `contexts/UnreadContext.jsx` tracks per-friend
  unread counts from `messages.read_at`, updates the browser tab title,
  and exposes `markRead()` called when a chat opens.
- **Typing / read receipts / reactions / edit / delete / reply** — all
  live in `ChatWindow.jsx` + `MessageBubble.jsx`, using Realtime broadcast
  (typing) and `postgres_changes` UPDATE events (everything else) on the
  same per-conversation channel.
- **Voice messages** — recorded client-side with the `MediaRecorder` API,
  uploaded to the `chat-attachments` bucket as a `.webm` file.
- **Calling** — `contexts/CallContext.jsx` (1:1) and
  `contexts/GroupCallContext.jsx` (group) both do WebRTC signaling over
  Supabase Realtime broadcast channels — no separate signaling server.
  Call outcomes (`completed`/`missed`/`declined`) log to the `calls`
  table for `CallHistoryModal.jsx`.
- **Groups** — a parallel table set (`groups`/`group_members`/
  `group_messages`) so the original 1:1 chat logic is untouched.
  `GroupChatWindow.jsx` and `GroupsList.jsx` handle the UI;
  `GroupCallContext.jsx` handles group calling.
- **Blocking** — `blocks` table plus a database-level check in the
  `messages` insert policy, so a block is enforced even if the UI is
  bypassed.
- **Theming** — unchanged architecture from v3/v4: CSS custom properties
  applied globally (`ThemeContext`) or scoped per-chat via inline style
  on `ChatWindow`'s root element. `DARK_THEME` in `theme/fields.js` is
  just another theme object, applied the same way as any custom one.

## Extending it later

- A TURN server (see `.env` above) for more reliable calling
- Push notifications via a service worker + Web Push (would also want a
  small backend/Edge Function to trigger them)
- Rich link-preview cards (needs a backend URL-metadata fetcher)
- Group-chat reactions and read receipts
- An SFU-based group call service for larger groups
