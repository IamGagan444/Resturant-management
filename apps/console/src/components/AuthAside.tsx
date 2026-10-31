import { ChefHat, QrCode, ReceiptText } from "lucide-react";
import { BrandMark } from "./ui";

/** Brand panel beside the sign-in form on large screens. */
export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#1c1814] p-12 text-white lg:flex lg:flex-col">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgb(234_122_46/0.45),transparent_45%),radial-gradient(circle_at_85%_90%,rgb(176_141_87/0.35),transparent_40%)]"
      />
      <div className="relative flex items-center gap-3">
        <BrandMark className="h-11 w-11 text-xl" />
        <span className="text-lg font-semibold tracking-tight">Restaurant Console</span>
      </div>
      <div className="relative mt-auto max-w-md">
        <p className="font-display text-4xl leading-tight font-semibold">Every table, every ticket, every rupee — in one calm place.</p>
        <ul className="mt-8 space-y-3 text-sm text-white/75">
          <li className="flex items-center gap-3">
            <QrCode className="h-4 w-4 text-brand-2" aria-hidden /> QR ordering in four languages
          </li>
          <li className="flex items-center gap-3">
            <ChefHat className="h-4 w-4 text-brand-2" aria-hidden /> Kitchen screens that keep working offline
          </li>
          <li className="flex items-center gap-3">
            <ReceiptText className="h-4 w-4 text-brand-2" aria-hidden /> GST bills, UPI and split payments
          </li>
        </ul>
      </div>
    </aside>
  );
}
