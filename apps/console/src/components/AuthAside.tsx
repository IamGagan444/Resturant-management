import { ChefHat, QrCode, ReceiptText } from "lucide-react";
import { BrandMark } from "./ui";

/** Brand panel beside the sign-in form on large screens. */
export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-black p-12 text-white lg:flex lg:flex-col">
      <div className="relative flex items-center gap-3">
        <BrandMark className="h-11 w-11 bg-white! text-xl text-black!" />
        <span className="text-lg font-bold tracking-tight">Restaurant Console</span>
      </div>
      <div className="relative mt-auto max-w-md">
        <p className="text-5xl leading-[1.15] font-bold tracking-tight">Every table, every ticket, every rupee — in one calm place.</p>
        <ul className="mt-10 space-y-4 text-[15px] text-white/80">
          <li className="flex items-center gap-3">
            <QrCode className="h-4 w-4 text-white/70" aria-hidden /> QR ordering in four languages
          </li>
          <li className="flex items-center gap-3">
            <ChefHat className="h-4 w-4 text-white/70" aria-hidden /> Kitchen screens that keep working offline
          </li>
          <li className="flex items-center gap-3">
            <ReceiptText className="h-4 w-4 text-white/70" aria-hidden /> GST bills, UPI and split payments
          </li>
        </ul>
      </div>
    </aside>
  );
}
