import {
  ArrowRight,
  Box,
  CalendarCheck,
  Nfc,
  Star,
  Tags,
  BellRing,
  Check,
  ChefHat,
  IndianRupee,
  Languages,
  LayoutDashboard,
  PackageX,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { SITE, demoHref } from "@/site";

const STEPS = [
  { n: "1", title: "Guest taps or scans", body: "A tap on the NFC card (or a scan of its QR code) opens your menu in the phone's browser. Nothing to download, no sign-up." },
  { n: "2", title: "Kitchen gets the KOT", body: "The order lands on the right station's screen (tandoor, kitchen, bar) with a chime, in under a second." },
  { n: "3", title: "Waiter serves", body: "When the dish is ready the waiter's phone buzzes. The guest watches every step on their own tracker." },
  { n: "4", title: "Pay by UPI", body: "Guests pay from the table, or at the counter by cash or card. The GST bill goes out on WhatsApp." },
];

const FEATURES = [
  {
    icon: QrCode,
    title: "QR table ordering",
    body: "A fast, photo-rich menu that opens instantly. Friends at the same table join with a 4-digit table code and order together.",
  },
  {
    icon: Nfc,
    title: "Tap-to-order NFC cards",
    body: "Guests tap their phone on a branded card on the table and the menu opens in a second. A QR code on the same card covers phones without NFC.",
  },
  {
    icon: Box,
    title: "3D & AR dishes",
    body: "Add a 3D model to any dish: guests spin it in 3D or place it on their own table in AR before they order. Plus sharp photos for every dish.",
  },
  {
    icon: Tags,
    title: "Smart tags that sell",
    body: "Bestseller, Chef's choice, Must try, New launch and more. Put them on your high-margin dishes and watch those orders grow.",
  },
  {
    icon: Star,
    title: "Google review card",
    body: "When the bill comes, guests tap the review card and land straight on your Google review page. More 5-star reviews, less asking.",
  },
  {
    icon: CalendarCheck,
    title: "Staff attendance, automatic",
    body: "See who came in today, who is on duty right now, and everyone's hours, straight from their sign-ins. Mark leave and week offs in a tap.",
  },
  {
    icon: ChefHat,
    title: "Kitchen display (KDS)",
    body: "Tickets split by station. Cards turn amber, then red, as they age against each dish's prep time, so nothing is forgotten.",
  },
  {
    icon: BellRing,
    title: "Waiter app",
    body: "Each waiter sees only their tables: food ready to pick up, guest requests, and tables waiting to be cleaned.",
  },
  {
    icon: IndianRupee,
    title: "UPI payments & split bills",
    body: "“Pay now” holds an order until the UPI payment succeeds. Split any bill equally, by guest or by item. Money goes to your own account.",
  },
  {
    icon: ReceiptText,
    title: "GST billing",
    body: "Correct GST per rate on every invoice. Send the digital bill by WhatsApp or SMS and skip the printer roll.",
  },
  {
    icon: PackageX,
    title: "Live stock control",
    body: "Mark a dish out of stock and it disappears from every guest's menu at once. If it runs out mid-order, the guest picks a swap.",
  },
  {
    icon: LayoutDashboard,
    title: "Live floor & day report",
    body: "A map of every table: who is seated, for how long, what is cooking and what is due. Daily sales, GST and top items, ready to print.",
  },
  {
    icon: WifiOff,
    title: "Works when the internet doesn't",
    body: "The kitchen keeps working through Wi-Fi drops. Every tap is saved and syncs the moment the connection is back.",
  },
  {
    icon: Languages,
    title: "Menus in your guests' language",
    body: "English, हिन्दी, ଓଡ଼ିଆ and తెలుగు. Guests switch with one tap; your default language shows first.",
  },
];

const ROLES = [
  { who: "Owners", what: "Live floor, day reports, menu and price control, audit log of every void and discount." },
  { who: "Kitchen", what: "One tap to start a dish, one tap when it's ready. Big type, dark screen, made for a busy pass." },
  { who: "Waiters", what: "Alerts on their own phone. Picked up, served, table cleaned. Nothing to write down." },
  { who: "Cashier", what: "Open any table, split the bill, take cash, card or UPI, and send the GST invoice." },
];

const FAQ = [
  {
    q: "Do my guests need to download an app?",
    a: `No. Guests scan the QR code on the table and the menu opens in their phone's browser. They enter a name and order. That's it.`,
  },
  {
    q: "What hardware do I need?",
    a: `Nothing special. ${SITE.name} runs in the browser on the phones, tablets and computers you already have: a tablet or TV for the kitchen, phones for waiters, any computer for the counter. Staff sign in on a paired device with their own PIN.`,
  },
  {
    q: "How do UPI payments work? Who holds the money?",
    a: "Payments go through your own Razorpay account, so your restaurant is the merchant and money settles straight to your bank. Guests can pay before the food is cooked (“Pay now”) or at the end of the meal.",
  },
  {
    q: "What happens if the internet goes down?",
    a: "The kitchen screen keeps working. Taps are saved on the device and sync within seconds once the connection returns. For restaurants with unreliable internet, a small local hub keeps all devices talking over your own Wi-Fi.",
  },
  {
    q: "Does it handle GST?",
    a: "Yes. Prices can be tax-exclusive or inclusive, every invoice shows GST per rate, and the day report totals GST for your filings.",
  },
  {
    q: "Is it only for restaurants?",
    a: "It works for restaurants, cafés, bars and hotel restaurants: anywhere guests sit at a table and order, plus parcel orders at the counter.",
  },
  {
    q: "How does the NFC table card work?",
    a: "Each card holds your table's menu link. Guests tap it with their phone (iPhones and most Android phones read NFC with no app) and the menu opens. The same card has a QR code for phones without NFC. You can write cards yourself from the dashboard on an Android phone.",
  },
  {
    q: "How is staff attendance tracked?",
    a: "Staff already sign in on the kitchen screen, waiter phone or counter with their PIN. Those sign-ins become the attendance register automatically: first in, last seen, hours on duty. Managers mark leave and week offs, and any correction is logged.",
  },
  {
    q: "What plans do you offer?",
    a: "Monthly, quarterly and yearly plans. Quarterly and yearly cost less per month. Book a demo and we'll suggest the right plan for your number of tables.",
  },
  {
    q: "Which languages does the guest menu support?",
    a: "English, Hindi, Odia and Telugu today, with more Indian languages on the way.",
  },
];

// Structured data (schema.org): lets Google show the site as a software product, with FAQ answers.
// No ratings or prices here on purpose: only add them once they are real.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE.url}/#org`,
      name: SITE.name,
      url: SITE.url,
      logo: `${SITE.url}/icon.svg`,
      email: SITE.email,
      areaServed: "IN",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#website`,
      url: SITE.url,
      name: SITE.name,
      inLanguage: "en-IN",
      publisher: { "@id": `${SITE.url}/#org` },
    },
    {
      "@type": "SoftwareApplication",
      name: SITE.name,
      url: SITE.url,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Restaurant management software",
      operatingSystem: "Web browser (Android, iOS, Windows, macOS)",
      description: SITE.description,
      featureList: FEATURES.map((f) => f.title),
      publisher: { "@id": `${SITE.url}/#org` },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

const btn =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold transition-[transform,background-color] duration-150 active:scale-[0.97]";
const btnPrimary = `${btn} bg-brand text-brand-ink hover:brightness-110`;
const btnGhost = `${btn} border border-line bg-surface text-ink hover:bg-sunken`;

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight" aria-label={`${SITE.name} home`}>
      <img src="/icon.svg" alt="" width={32} height={32} className="rounded-lg" />
      {SITE.name}
    </a>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-muted md:flex">
          <a href="#how-it-works" className="hover:text-ink">How it works</a>
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <a href={SITE.consoleUrl} className="hidden rounded-full px-4 py-2 text-sm font-semibold text-ink hover:bg-sunken sm:inline-flex">
            Sign in
          </a>
          <a href={demoHref} className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:brightness-110">
            Book a demo
          </a>
        </div>
      </div>
    </header>
  );
}

/** Product preview built from markup (no screenshots to keep in sync): a guest's phone and a kitchen ticket. */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-brand-soft blur-2xl" />
      <div className="grid items-end gap-4 sm:grid-cols-[1fr_1.1fr]">
        {/* phone (hidden on small phones: two mock-ups side by side don't fit at 375px) */}
        <div className="hidden rounded-[2rem] border border-line bg-surface p-2.5 shadow-lift sm:block">
          <div className="rounded-[1.5rem] bg-sunken p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-sm font-bold">Table 4</span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">EN · हिं</span>
            </div>
            {[
              ["Paneer Tikka", "₹280"],
              ["Dal Makhani", "₹240"],
              ["Butter Naan ×2", "₹120"],
            ].map(([dish, price]) => (
              <div key={dish} className="mb-2 flex items-center justify-between rounded-xl bg-surface px-2.5 py-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="grid size-2.5 place-items-center rounded-[2px] border border-fresh">
                    <span className="size-1 rounded-full bg-fresh" />
                  </span>
                  {dish}
                </span>
                <span className="font-semibold">{price}</span>
              </div>
            ))}
            <div className="mt-3 rounded-full bg-brand py-2 text-center text-[11px] font-bold text-brand-ink">Pay ₹640 by UPI</div>
          </div>
        </div>
        {/* KDS ticket */}
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-lift">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-base font-extrabold">T4 · KOT #128</span>
              <span className="rounded-full bg-fresh/15 px-2 py-0.5 text-[11px] font-bold text-fresh">2 min</span>
            </div>
            <ul className="space-y-2 text-[13px]">
              <li className="flex items-center justify-between">
                <span>Paneer Tikka</span>
                <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">Cooking</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Dal Makhani</span>
                <span className="rounded-full bg-fresh/15 px-2 py-0.5 text-[11px] font-semibold text-fresh">Ready</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Butter Naan ×2</span>
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">New</span>
              </li>
            </ul>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-soft">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-brand-ink">
              <BellRing className="size-4" />
            </span>
            <div className="text-[12px] leading-snug">
              <div className="font-semibold">Dal Makhani ready</div>
              <div className="text-muted">Ravi · pick up for T4</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ eyebrow, title, intro, id }: { eyebrow: string; title: string; intro?: string; id: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
      <h2 id={id} className="text-3xl font-extrabold sm:text-4xl">
        {title}
      </h2>
      {intro && <p className="mt-4 text-lg text-muted">{intro}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink">
        Skip to content
      </a>
      <Header />

      <main id="main" className="overflow-x-clip">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="animate-rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">
              <span className="size-1.5 rounded-full bg-brand" /> Made for restaurants in India
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              QR ordering, kitchen display and billing. <span className="text-brand">One app.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Guests scan, order and pay by UPI from the table. Orders reach the kitchen in a second, waiters know exactly what
              to pick up, and you close the day with GST-ready reports. Even when the Wi-Fi drops.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={demoHref} className={btnPrimary}>
                Book a free demo <ArrowRight className="size-4" />
              </a>
              <a href="#how-it-works" className={btnGhost}>
                See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {["Tap or scan: no app for guests", "Runs on phones you already have", "UPI to your own account"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="size-4 text-brand" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" id="how-it-works" className="border-y border-line bg-surface py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead
              id="how-title"
              eyebrow="How it works"
              title="From table to kitchen to bill, without a single paper KOT"
              intro="Every order follows the same four steps, and everyone (guest, cook, waiter, cashier) sees it move live."
            />
            <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-2xl border border-line bg-bg p-6">
                  <span className="mb-4 grid size-10 place-items-center rounded-full bg-brand font-display text-lg font-extrabold text-brand-ink">
                    {s.n}
                  </span>
                  <h3 className="mb-2 text-lg font-bold">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features-title" id="features" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHead
              id="features-title"
              eyebrow="Features"
              title="Everything a busy restaurant needs on a Saturday night"
              intro="Built so staff learn it in minutes: one or two taps for everything they do all day."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
                  <span className="mb-4 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mb-2 text-lg font-bold">{title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Roles */}
        <section aria-labelledby="roles-title" className="border-y border-line bg-surface py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand">For your whole team</p>
              <h2 id="roles-title" className="text-3xl font-extrabold sm:text-4xl">
                Every person gets a screen made for their job
              </h2>
              <p className="mt-4 text-lg text-muted">
                Pair a device once, then staff tap their face and enter a PIN. No shared passwords, and owners can see who did what.
              </p>
              <ul className="mt-6 space-y-3 text-[15px]">
                <li className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                  <span>Audit log of every void, cancellation, discount and price change, with who, when and why.</span>
                </li>
                <li className="flex gap-3">
                  <Smartphone className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                  <span>Works on any Android or iPhone, tablet, laptop or kitchen TV with a browser.</span>
                </li>
              </ul>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              {ROLES.map((r) => (
                <div key={r.who} className="rounded-2xl border border-line bg-bg p-5">
                  <dt className="mb-1.5 font-display text-lg font-bold">{r.who}</dt>
                  <dd className="text-[15px] leading-relaxed text-muted">{r.what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" id="faq" className="py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHead id="faq-title" eyebrow="FAQ" title="Questions restaurant owners ask us" />
            <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[17px] font-bold [&::-webkit-details-marker]:hidden">
                    <h3>{f.q}</h3>
                    <span className="text-xl text-muted transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section aria-labelledby="cta-title" className="px-4 pb-24 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-[2rem] bg-ink px-6 py-16 text-center text-bg sm:px-12">
            <h2 id="cta-title" className="text-3xl font-extrabold sm:text-4xl">
              See your own menu running in {SITE.name}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg opacity-75">
              Book a 20-minute demo. We set up your menu and tables and show you the full flow, from QR scan to GST bill.
            </p>
            <a href={demoHref} className={`${btnPrimary} mt-8`}>
              Book a free demo <ArrowRight className="size-4" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-col gap-2">
            <Logo />
            <p>Restaurant ordering, kitchen display and billing software for India.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
            <a href={`mailto:${SITE.email}`} className="hover:text-ink">{SITE.email}</a>
            <a href={SITE.consoleUrl} className="hover:text-ink">Sign in</a>
          </nav>
        </div>
        <p className="pb-8 text-center text-xs text-muted">© {new Date().getFullYear()} {SITE.name}</p>
      </footer>
    </>
  );
}
