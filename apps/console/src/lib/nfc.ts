/**
 * Web NFC (Chrome on Android): write a link onto an NFC sticker or card, so guests tap their phone on it instead of
 * scanning. Every phone (iPhone XS+ and NFC Android) opens a URL record with no app. Writing needs Chrome on
 * Android; elsewhere the screen offers the link to copy into a free writer app (NFC Tools).
 */
interface NdefWriter {
  write(message: { records: { recordType: "url"; data: string }[] }, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  makeReadOnly?(options?: { signal?: AbortSignal }): Promise<void>;
}
type NdefCtor = new () => NdefWriter;

const ctor = (): NdefCtor | null => (typeof window !== "undefined" && "NDEFReader" in window ? (window as unknown as { NDEFReader: NdefCtor }).NDEFReader : null);

export const nfcSupported = () => ctor() !== null;

/** Resolves once a tag held to the phone has the link (and is locked, if asked). Rejects on abort or failure. */
export async function writeNfcUrl(url: string, opts: { signal?: AbortSignal; lock?: boolean } = {}): Promise<void> {
  const C = ctor();
  if (!C) throw new Error("This browser can't write NFC tags");
  const writer = new C();
  await writer.write({ records: [{ recordType: "url", data: url }] }, { overwrite: true, signal: opts.signal });
  if (opts.lock) {
    if (!writer.makeReadOnly) throw new Error("This browser can't lock NFC tags");
    await writer.makeReadOnly({ signal: opts.signal });
  }
}
