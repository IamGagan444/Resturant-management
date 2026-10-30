import type { PublicMenu } from "@rms/contracts";
import { TableApp } from "@/components/TableApp";

/**
 * Server-rendered menu: the first paint on slow 4G already has the full menu as HTML,
 * the client bundle then hydrates for cart/ordering.
 */
async function getMenu(slug: string): Promise<PublicMenu | null> {
  const res = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/v1/p/h/${encodeURIComponent(slug)}/menu`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json() as Promise<PublicMenu>;
}

export default async function TablePage({ params }: { params: Promise<{ slug: string; qrToken: string }> }) {
  const { slug, qrToken } = await params;
  const menu = await getMenu(slug);
  if (!menu) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">This restaurant isn&apos;t available right now</h1>
        <p className="muted mt-2">Please ask the staff for help.</p>
      </main>
    );
  }
  return <TableApp initialMenu={menu} qrToken={qrToken} />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const menu = await getMenu(slug);
  return { title: menu ? `${menu.hotel.name} · Menu` : "Menu" };
}
