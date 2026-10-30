# Phase 4 design: expansion

Status: **design only**, nothing built. Each module is behind a plan feature flag (`Plan.features` / `Hotel.featureOverrides` already exist), so hotels opt in one module at a time.

| Module | What it gives the hotel | Builds on | Rough effort | Lead time outside our control |
| --- | --- | --- | --- | --- |
| 1. Room service + room folio | Guests order from the room QR and "charge to room"; one statement at checkout | `Table.isRoom`, `PaymentMethod.ROOM_CHARGE` (both already in the schema) | 2 weeks | none |
| 2. Inventory | Stock follows sales; dishes go out of stock by themselves; daily wastage and variance | item status pipeline, availability toggle | 3 weeks | none |
| 3. Loyalty | Points on paid bills, redeemed as a discount | `Customer` (phone captured at join) | 2 weeks | SMS sender registration (DLT), 2–4 weeks: start now |
| 4. Swiggy / Zomato | Delivery orders land on the same kitchen screen; one stock switch for all channels | order pipeline, `OrderSource` | 3–4 weeks | aggregator / integration-partner approval, weeks to months |
| 5. AI insights | Weekly plain-language summary and suggestions for the owner | day report data | 1–2 weeks | needs 4–8 weeks of real data first |

**Recommended order:** 1 → 2 → 3 → 4 → 5. Start the DLT registration (3) and the aggregator partner application (4) **now**, because they gate their modules.

---

## 1. Room service and room folio

**Decision: we don't build a property management system (PMS).** A folio here holds food and drink charged to a room. Room tariff stays in the hotel's PMS. At checkout we either settle the folio ourselves or hand the total to the PMS.

### Flow
1. **Check-in.** Front desk opens a folio for the room: guest name, mobile, expected checkout. This can come from the PMS later.
2. **Guest orders from the room.** The guest scans the room QR. Verification is the last 4 digits of the mobile on the folio, which replaces the table join code. Orders go to the kitchen as today. Waiter tasks become "deliver to Room 204".
3. **Charging to the room.** The guest taps **Charge to room**. The bill settles with a `ROOM_CHARGE` payment that posts a line to the folio, and the GST invoice is issued now, as today. Only possible while the folio is open.
4. **Checkout.** The front desk sees the folio statement: every bill, its invoice number and the total. They settle it by cash, card or UPI, or mark it "posted to PMS" with a reference. The folio then closes.

### Schema
```prisma
model Folio {
  id          String      @id @default(cuid())
  hotelId     String
  tableId     String      // the room (Table with isRoom = true)
  guestName   String
  guestPhone  String
  status      FolioStatus @default(OPEN)   // OPEN, SETTLED, POSTED_TO_PMS, VOID
  openedAt    DateTime    @default(now())
  closedAt    DateTime?
  pmsRef      String?
  @@index([hotelId, status])
}
// Payment gains folioId (set when method = ROOM_CHARGE).
// Folio settlement = Payments with folioSettlementId; the folio balance is computed, never stored.
```

### Rules
- One open folio per room: a partial unique index, the same pattern as one live session per table.
- A room charge needs an open folio and the verified guest. Charge limit per folio is a hotel setting (default ₹25,000). Above it, the order needs a front-desk OK.
- **GST.** Each bill keeps its own invoice, so tax is correct per bill. Room-tariff-linked rates for in-hotel restaurants vary by tariff slab and recent rate changes. Keep rates configurable per hotel via the existing `Tax` table and **have a CA confirm the current slabs** before launch.
- Late-night room orders use the existing business day (`dayStartsAt`).

### API
- `POST /v1/admin/folios`, `POST /v1/admin/folios/:id/settle`, `GET /v1/admin/folios?status=OPEN`
- `POST /v1/p/bill/charge-to-room` (guest)
- Event `folio:charged` to front desk and managers

---

## 2. Inventory

**Goal:** the kitchen stops running out by surprise. Dishes switch themselves off when an ingredient runs out, and the owner sees what went where.

### Model
- **Ingredient:** name, unit (g, ml or piece), current stock, reorder level.
- **Recipe line:** menu item or variant → ingredient and quantity. Add-ons can carry recipe lines too (for example, extra cheese).
- **Stock movement:** an append-only ledger of `PURCHASE`, `SALE`, `WASTAGE`, `ADJUSTMENT` and `TRANSFER`, each with a reason and the staff member. Current stock is the sum of movements. Like money, it is never edited in place.

### When stock moves
- **Consumption is recorded when an item reaches READY**, not when it's ordered. Cancelled orders never consume, and food cooked and then wasted is recorded as wastage.
- The posting is idempotent per order item (unique `orderItemId` + ingredient), so offline and hub replays can't double-count.

### Out of stock
- When a recipe can no longer be made, the dish is switched off with the existing availability toggle, so every menu updates and the out-of-stock flow works unchanged.
- The cook can switch it back on: real stock is often ahead of the books. The override is logged in the audit log.

### Screens and reports
- **Screens:** purchase entry (scan an invoice photo later), stock count, wastage, low-stock list.
- **Day report additions:** consumption, wastage, and variance (book stock − counted stock).

### Risks
- **Recipe setup is the hard part.** Ship CSV import plus starter templates for common dishes.
- **Unit mistakes** (kg vs g). Store one base unit per ingredient and convert only at the screen.

---

## 3. Loyalty

**Goal:** regulars come back, with rules simple enough for a cashier to explain in one line: "1 point per ₹100, 100 points = ₹50 off".

### Rules
- **Who:** members are identified by mobile (`Customer`, which already exists). Joining needs an OTP once, which requires DLT-registered SMS templates; start registration now.
- **Earning:** points are earned on settled bills only, after the bill is PAID, on the amount before tax and service charge. They post via an idempotent job keyed on the bill.
- **Redeeming:**
  - The guest gets an OTP, or the cashier confirms against the guest's mobile.
  - Points apply as a bill **discount**, so the existing GST logic reduces the taxable value correctly. The audit log already records discounts.
  - There is a cap per bill; the hotel sets a maximum %.
- **Expiry:** points expire after N months; this is configurable.
- **Ledger:** append-only `LoyaltyEntry` rows (EARN, REDEEM, EXPIRE, ADJUST). The balance is a sum.
- **Bill reversal:** a void reverses its earn entry.
- **Privacy:**
  - Members opt in explicitly (DPDP Act 2023).
  - Phone numbers are visible to managers only.
  - A member can ask to be deleted, which anonymises their ledger rows.

---

## 4. Swiggy / Zomato

**Decision: integrate through a licensed POS-integration partner (for example UrbanPiper) rather than the aggregators directly.** Direct order APIs are available only to approved partners. One partner API covers both aggregators (and ONDC later), and they handle menu-sync rules per platform.

### Flow
1. **Menu sync.** Our menu becomes the partner's catalogue. Prices per channel can differ, using price overrides per channel. Stock toggles push to every channel in one tap.
2. **Order in.** The partner sends a webhook, which we verify by signature and deduplicate in the `WebhookEvent` table we already have. We create an order with a new `OrderSource` value of `SWIGGY` or `ZOMATO` and a virtual "Delivery" table session. Items go to the kitchen screen with a coloured channel badge.
3. **Statuses back to the partner.** Accept, food ready and rider handed over are sent back automatically from item status changes.
4. **Payment and tax.** The aggregator collects the money and pays the GST on these orders under section 9(5). Our invoice shows these orders separately and excludes that tax from our GST totals. **Confirm with a CA.**

### Risks
- **Acceptance time.** Aggregators penalise slow acceptance. Auto-accept is a setting, and the order chimes as an alert-level sound.
- **During an outage** delivery orders can't arrive (they come through the cloud). Pause the channels automatically when the hub takes over. The partner API supports store pause.

---

## 5. AI insights

**Goal:** a short weekly note to the owner that a busy person actually reads, for example: "Paneer Tikka sales fell 30% after the price change; Tuesdays 3–5 pm are empty; tandoor tickets ran late on Friday."

### How it works
- **Facts come from SQL, not the model.** A weekly job computes the numbers the note may mention: the day report, item trends week over week, ticket ageing by station and hour, discounts, voids, and stock-outs.
- **The model only writes the note.** It gets that small JSON with no customer personal data, and writes the note in the owner's language.
- **Models:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) for the weekly note, and Haiku 5.5 (`claude-haiku-5-5`) for cheap one-line alerts.
- **Grounding:** every number in the note must come from the input. Each claim links back to the report it came from, and the prompt forbids numbers that aren't in the input.
- **Delivery:** in the manager screen, and optionally by WhatsApp once the provider from Phase 2's gap list is in place.
- **Cost:** one call per hotel per week, a few cents. Hotels can switch it off; it's a plan feature.
- **Later:** demand forecasts for prep and purchase quantities. Start with plain statistics (same weekday, trailing weeks). Use a model only if that proves insufficient.

---

## Cross-cutting

- **Feature flags:** check `plan.features` combined with `featureOverrides` in the route guards. Hidden screens don't load.
- **Tenant isolation:** every new model gets `hotelId` and the existing Prisma extension. The isolation test suite grows with each module.
- **Offline / hub:**
  - **Need the cloud:** room charges, loyalty redemption and delivery orders.
  - **Work offline:** stock counts and wastage, as new command types through the existing queue.
- **Audit additions:** room charges over the limit, inventory overrides, point adjustments, channel pauses.

## Open questions for you

1. **Room service:** should we build a PMS hand-off (export or webhook), and for which PMS? Or is folio settlement inside our system enough for the first hotels?
2. **Inventory:** deduct stock when food is ready (recommended) or when it's ordered?
3. **Loyalty:** one programme per hotel, or shared across a chain? Chains were deferred in Phase 0.
4. **Delivery:** is there already an integration partner account (UrbanPiper or similar), or should we apply?
5. **AI insights:** English only first, or the owner's language from the start?
