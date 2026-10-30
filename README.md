# Restaurant & Hotel Ordering (multi-tenant SaaS)

Table QR ordering, kitchen display, waiter app, billing and admin for restaurants and hotels in India.
Built to be the **easiest and most reliable** option for staff and guests: 1–2 taps for common actions,
no lost or duplicated orders, and guests always know where their food is.

## Quick start

Prerequisites: Node 20+, pnpm 10, Docker Desktop.

```bash
cp .env.example .env            # then set the secrets (see "Environment")
docker compose up -d            # Postgres 16 + Redis 7
pnpm install
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # demo hotel "Spice Garden"
pnpm dev                        # API :4000 · customer :3000 · console :3001
```

| App | URL | Who |
| --- | --- | --- |
| Customer (mobile web) | http://localhost:3000/h/spice-garden/t/{qrToken} (seed prints a T1 link) | Guests, no login |
| Console | http://localhost:3001 | Kitchen, waiters, cashier, manager, super admin |
| API | http://localhost:4000 | — |

## Demo walkthrough

Seeded logins:

| Who | How |
| --- | --- |
| Super admin | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env` → `/login` |
| Owner | `owner@spicegarden.test` / `owner12345` → `/login` |
| Staff PINs (on a paired device) | Manager 1000 · Cashier Kavya 2000 · Cooks Raju 3001 (Tandoor), Suresh 3002 (Kitchen), Deepak 3003 (Bar) · Waiters Ravi 4001 (T1–T4, R1–R2), Priya 4002 (T5–T8, R3–R4) |

1. **Pair devices.** Open the console in a browser window, sign in as the owner, go to **Devices**, and pair it as a *Kitchen screen*. You're signed out and land on the PIN picker: tap **Raju** and enter 3001. Repeat in another browser profile as a *Waiter phone* (Ravi, 4001) and a *Counter* (Kavya, 2000).
2. **Order as a guest.** Open the T1 link printed by the seed, preferably in a phone-sized window. Enter a name, add dishes, and place the order. A second phone needs the 4-digit table code shown on the first.
3. **Cook.** The ticket appears on the kitchen screen with a chime. Tap an item to start it, tap again when it's ready (or tap **Bump**). The card turns amber, then red, as it ages against the dish's prep time.
4. **Serve.** The waiter gets an alert. Tap **Picked up**, then **Served**. The guest's tracker updates live.
5. **Pay.** The guest taps **🧾 Bill**, then **Pay by UPI** (mock gateway in dev). Alternatively, the counter collects cash or card. The table moves to *cleaning*, and the waiter taps **Ready ✓**.
6. **Out of stock.** The kitchen opens **Stock** and taps an item. It greys out on guest menus immediately. If a dish on a ticket can't be made, the cook taps **Ran out** next to it: the dish is hidden from menus and the guest sees **Pick something else**, chooses a dish, and the swap lands on the same kitchen ticket. Waiters can swap it for the guest too.
7. **Pay now.** In the cart, **Pay now by UPI** holds the order until payment succeeds, then sends it to the kitchen. When guests have paid for everything, the Bill tab shows **We're done, close the table**, which closes the bill and frees the table.
8. **Split the bill.** At the counter, open a table and use **Split bill**: equal parts, by guest (who ordered what), or by item. Each guest then pays their part by UPI from their phone, or the cashier collects each part.
9. **Digital bill.** After the last payment the counter asks for the guest's mobile and opens WhatsApp or SMS pre-filled with a link to the GST invoice. Guests paying by UPI get the same link on their thank-you screen.
10. **Live floor and day report.** Managers open **Live floor** for a map of every table (guests, time seated, amount due, food cooking or waiting, open requests) with overdue pickups in red; **Arrange tables** lets them drag tables into place. **Day report** shows sales, GST per rate, money received by method, top items and discounts for any business day, ready to print.
11. **Language.** Guests pick English, हिन्दी, ଓଡ଼ିଆ or తెలుగు from the menu header. The restaurant's default language is used until they choose.
12. **Offline.** On the kitchen screen, turn the Wi-Fi off and tap a dish: it moves on screen and the banner says the tap is saved. Turn the Wi-Fi back on and it reaches the server within seconds.
13. **Audit log.** Manage → **Audit log** lists voids, cancellations, discounts, stock and price changes (who, when, why), plus any offline taps the server refused.
14. **Super admin.** Sign in with the admin email. From there you can onboard a hotel, change its status or plan, and view platform health.

## Repo layout

```
apps/
  api/        Fastify + Socket.IO + BullMQ. src/{routes,services,lib,realtime,jobs,payments}
  customer/   Next.js App Router, server-rendered menu, minimal client JS
  console/    Next.js static export (client-only): /kds /waiter /cashier /floor /reports /manage /platform /device /login
  hub/        Local hub for internet outages: Fastify + Socket.IO, JSON-file state, no database
packages/
  db/         Prisma schema + migrations, tenant extension, seed
  contracts/  Zod schemas, socket event contract, shared enums (browser-safe)
  domain/     Pure logic: status machine, pricing, GST bill, splits, business day, KDS helpers
e2e/          Playwright full-flow test
```

## Design notes

- **Tenant isolation lives in the data layer.** Every tenant model has `hotelId`. `packages/db/src/tenant.ts` is a Prisma extension that injects `hotelId` into every query, using AsyncLocalStorage set by the route guards. Queries without a tenant context throw. Any ID taken from input and used as a foreign key is checked by `assertOwned()`, because a foreign key only proves the row exists, not that it belongs to this tenant. Tests: `apps/api/test/tenant.test.ts`.
- **No lost or duplicate orders.** Every create carries a client-generated `clientId`. Retries return the same order or payment, enforced by a unique index plus a lookup.
- **Status only moves forward.** All item status changes go through `transitionItem()`, which uses the state machine in `packages/domain/src/status.ts`. A stale or replayed command is a no-op, never a regression. This is what makes the Phase 3 offline sync conflict-free.
- **Realtime is a hint.** Socket events carry IDs only. Clients refetch over REST on every reconnect, so a missed event never leaves a screen wrong.
- **Prices are computed on the server only.** GST is broken up per rate. Discounts apply before tax. Service charge is taxed and removable (it is optional by law). Totals round to the rupee.
- **Bill numbers.** GST invoice numbers are sequential per financial year (`INV/2627/00042`). They are assigned atomically at settlement, so voided drafts never leave gaps.
- **Anti-prank controls:**
  - a second phone at a table needs the join code
  - optional waiter confirmation for a table's first QR order
  - rate limits on the public routes
  - QR codes can be rotated

## Environment

| Var | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | Match `docker-compose.yml` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | 32+ chars each. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. `ENCRYPTION_KEY` encrypts each hotel's Razorpay secrets at rest. |
| `STORAGE_DRIVER`, `UPLOAD_DIR` | Menu photos, resized to at most 1200 px WebP on upload. `local` stores them on disk, served by the API; `s3` uses the S3 settings below. |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL`, `S3_ENDPOINT` | Only for `STORAGE_DRIVER=s3`. The API refuses to start if one is missing. `S3_ENDPOINT` is only for R2 / MinIO. |
| `PAYMENTS_MOCK` | `true` = fake UPI gateway for local development. The API refuses to start with it in production. |
| `API_URL`, `CUSTOMER_URL`, `CONSOLE_URL` | Used for CORS, QR links and socket origins |
| `COOKIE_SECURE` | Set to `true` behind HTTPS |
| `RUN_WORKER` | `false` to run the BullMQ workers in a separate process |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Super admin created by the seed |

Razorpay keys are entered **per hotel**, by the owner under *Settings*. The webhook URL is `{API_URL}/v1/webhooks/razorpay/{hotelId}`.

## Offline and the local hub

Kitchen and waiter screens keep working without internet, at two levels:

| Situation | What happens |
| --- | --- |
| Patchy connection, or one device drops off | Every tap is saved in the device's IndexedDB queue first, shown on screen at once, and sent when the connection returns. The last tickets / board stay on screen (also after a reload: the service worker serves the app and the last data is cached). |
| The restaurant's internet is down | If a **local hub** is set up, screens switch to it automatically (amber banner). Kitchen, waiters and stock toggles keep working across devices on the Wi-Fi, including waiter-taken orders. When the internet returns the hub replays everything to the cloud, in order, as the staff member who did it. |

Replays are safe by design: every action has a client id, item status only moves forward, waiter orders use client-made item ids, and stock toggles are last-writer-wins by device time. Actions the server refuses on replay (for example, a cook trying to serve) appear under Manage → Audit log.

**Needs the internet, even with a hub:** bills and payments, new QR orders from guests' phones (they're on mobile data, not your Wi-Fi), menu editing and reports.

**Cheapest protection first:** a router with automatic 4G failover (about ₹2–3k) covers most outages without any of this. The hub is the second layer.

### Setting up a hub

1. **Hardware:** any always-on mini PC or Raspberry Pi 4/5 with Node 20+, wired to the restaurant router, on a fixed LAN IP.
2. **Name and certificate:** the console is served over HTTPS, so browsers only let it call the hub over HTTPS. Point a DNS name at the hub's LAN IP, e.g. `hub.spicegarden.in → 192.168.1.20`, and get a certificate for it (Let's Encrypt DNS challenge works for a private IP). Some routers block DNS answers with private IPs ("rebind protection"): allow that name.
3. **Pair it:** Manage → Devices → **Local hub** → enter `https://hub.spicegarden.in:4100` → copy the two lines shown (`CLOUD_URL`, `HUB_TOKEN`; the token is shown once).
4. **Run it:** copy the repo to the box, `pnpm install`, create `apps/hub/.env` from `apps/hub/.env.example` (paste the two lines, set `HUB_ALLOWED_ORIGINS` to the console URL and the TLS paths), then `pnpm hub`. Run it under a service manager (systemd / pm2) so it restarts on boot.
5. **Devices pick it up by themselves:** every signed-in kitchen / waiter device fetches a hub pass while online (valid 24 h, refreshed every 6 h), so nobody logs in again during an outage.

The hub keeps its state in `HUB_DATA_FILE` (written atomically); queued work survives a power cut. Pairing a new hub retires the old one's token and passes.

## Performance

Measured by `apps/api/test/perf.test.ts` on a busy night: 40 occupied tables, 200 open orders, 600 items. The database runs in Docker Desktop on Windows; a Linux server is faster.

| Endpoint | p50 |
| --- | --- |
| Guest menu (cached per hotel, cleared on every menu or stock change) | ~4 ms |
| Waiter board | ~15 ms |
| Kitchen display, all 200 tickets | ~110 ms (worst case down from 415 ms to 130 ms) |
| Counter live bills / manager floor (all 40 tables) | ~125 ms |
| Day report | ~135 ms |

JSON over 1 KB is gzip / brotli compressed. Indexes were added for the day report, the audit log filter and payment lookups.

## Tests

```bash
pnpm test        # unit (domain, tenant scoping) + API integration on a separate rms_test DB
pnpm lint
pnpm typecheck
pnpm e2e         # Playwright: scan → order → cook → serve → pay, pay now in Hindi, kitchen offline → sync
                 # runs its own API / customer / console on ports 4010 / 3010 / 3011 (mock payments),
                 # so it works next to a running `pnpm dev`; re-seeds the demo hotel
```

The first e2e run needs a browser: `pnpm --filter @rms/e2e install-browsers`.

## Status

**Phases 1, 2 and 3 are done.**

Phase 3 added:
- **Offline queue** for the kitchen and waiter screens: IndexedDB, `/v1/s/sync`, cached last data, a service worker, and a banner showing where work is going and what's waiting.
- **The local hub** (`apps/hub`).
- **The audit log screen**, including offline actions the server refused.
- **A performance pass:** menu cache, compression, kitchen-query rewrite, new indexes and a load test.
- **An isolated end-to-end stack** that runs next to `pnpm dev`.

Phase 2 summary: pay now, split bills, one UPI payment at a time per bill, out-of-stock swaps, digital receipts with WhatsApp / SMS links, live floor map, day report, guest app in 4 languages, S3 / R2 image storage.

Known gaps:

- **The hub needs HTTPS on a LAN name** in production (see "Setting up a hub"). It was tested end to end over plain HTTP on one machine, not yet on real restaurant hardware.
- **Not available during an outage:** counter and manager screens, and cancelling or rejecting orders. They show "needs the internet" while the hub is in use.
- **Two devices, both offline and without a hub,** don't see each other's taps until they reconnect.
- **Order numbers during an outage:** orders a waiter takes are numbered 9001, 9002… until the cloud gives them their real numbers.
- **Queued actions belong to whoever made them.** If someone else signs in on that device before they sync, they wait until the original person signs in again. Switching user tries to send them first.
- **WhatsApp / SMS** are pre-filled links on the staff device. Sending automatically needs a provider (WhatsApp Business API, MSG91).
- **Translations:** the Odia and Telugu text needs a native speaker's review. The staff console is English only.
- **Refunds** for an accidental double UPI payment are done in the Razorpay dashboard.
- **S3** has not been run against a real bucket; the `S3_*` values in `.env` are empty.
- **`PAYMENTS_MOCK` isn't set in `.env`,** so `pnpm dev` runs with UPI off until the hotel's Razorpay keys are entered (Manage → Settings). The e2e stack always uses the mock.
