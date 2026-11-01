import { ChefHat, CheckCircle2, QrCode, ReceiptText } from "lucide-react";
import { RestroMark } from "./RestroMark";

const FEATURES = [
  { icon: QrCode, text: "QR ordering in four languages" },
  { icon: ChefHat, text: "Kitchen screens that keep working offline" },
  { icon: ReceiptText, text: "GST bills, UPI and split payments" },
];

/** Brand panel beside the sign-in form on large screens: navy, a warm glow and a couple of live-looking tickets. */
export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-navy p-12 text-cream lg:flex lg:flex-col">
      {/* warm glow behind the content; a static gradient, so it costs nothing after first paint */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 85% 15%, color-mix(in oklab, var(--color-brand) 38%, transparent), transparent 70%), radial-gradient(50% 40% at 0% 100%, color-mix(in oklab, var(--color-brand) 22%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex animate-rise items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-cream text-navy shadow-lift">
          <RestroMark className="h-11 w-11" animated />
        </span>
        <span className="font-display text-3xl font-bold tracking-tight">restro</span>
      </div>

      {/* two order tickets drifting gently, like a kitchen rail */}
      <div aria-hidden className="relative mt-14 h-44">
        <div className="float-slow absolute top-0 left-0 w-64 rounded-2xl bg-cream p-4 text-navy shadow-lift">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="rounded-full bg-brand/15 px-2.5 py-1 text-brand">Table 4 · new</span>
            <span className="text-navy/60">2 min</span>
          </div>
          <p className="mt-3 text-sm font-semibold">2 × Paneer Tikka</p>
          <p className="text-sm text-navy/70">1 × Butter Naan · 1 × Masala Chaas</p>
        </div>
        <div className="float-slower absolute top-16 left-56 w-56 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-md">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-fresh" aria-hidden />
            Table 9 paid
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">₹1,240</p>
          <p className="text-xs text-cream/60">UPI · GST bill sent</p>
        </div>
      </div>

      <div className="relative mt-auto max-w-md">
        <p className="animate-rise font-display text-5xl leading-[1.1] font-bold tracking-tight [animation-delay:120ms]">
          Every table, every ticket, every rupee — <span className="text-brand">in one calm place.</span>
        </p>
        <ul className="stagger mt-10 space-y-3 text-[15px] text-cream/85">
          {FEATURES.map((f) => (
            <li key={f.text} className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10">
                <f.icon className="h-4 w-4 text-brand" aria-hidden />
              </span>
              {f.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
