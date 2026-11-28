import { NextResponse, type NextRequest } from "next/server";

/**
 * The address on the Google review NFC card / QR: /h/{slug}/review. Looks up the restaurant's current review link
 * (the API only ever returns Google hosts) and sends the guest there, so the printed card never needs changing.
 * No link set yet → the restaurant's menu page is not known here, so show a short plain message instead.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) return new NextResponse("Not found", { status: 404 });
  try {
    const res = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/v1/p/h/${slug}/review`, { cache: "no-store" });
    if (res.ok) {
      const { url } = (await res.json()) as { url: string | null };
      if (url) return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store" } });
    }
  } catch {
    // API unreachable: fall through to the message
  }
  return new NextResponse("This restaurant hasn't set up Google reviews yet. Thank you for visiting!", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
