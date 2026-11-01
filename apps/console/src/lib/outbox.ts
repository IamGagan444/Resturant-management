"use client";

import type { Command, QueuedCommand, SyncResult } from "@rms/contracts";
import { ApiError, NetworkError, api, newClientId } from "./api";
import { getMode, onModeChange, setPending } from "./net";

/**
 * Every kitchen / waiter action goes through this queue:
 *   1. saved in IndexedDB first (survives a reload or a dead battery)
 *   2. sent to /v1/s/sync on the cloud, or the local hub during an outage, oldest first
 *   3. removed once the server answered
 * The server side is idempotent (client ids, forward-only status), so re-sending after a lost response is safe.
 * Entries remember who made them: they're only sent while that person is signed in on this device.
 */

interface Entry extends QueuedCommand {
  seq?: number;
  staffId: string;
}

type Rejection = { command: Command; reason: string };

const DB = "rms-console";
const STORE = "outbox";
const BATCH = 100;

let me: string | null = null;
let memory: Entry[] = []; // fallback when IndexedDB is unavailable (private mode)
const rejectionListeners = new Set<(r: Rejection) => void>();
const flushedListeners = new Set<() => void>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        if (!d) return reject(new Error("no indexeddb"));
        const r = run(d.transaction(STORE, mode).objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

async function all(): Promise<Entry[]> {
  if (!(await db())) return memory;
  return tx<Entry[]>("readonly", (s) => s.getAll() as IDBRequest<Entry[]>);
}

async function add(e: Entry) {
  if (!(await db())) return void memory.push(e);
  await tx("readwrite", (s) => s.add(e));
}

async function remove(entries: Entry[]) {
  const ids = new Set(entries.map((e) => e.clientId));
  if (!(await db())) return void (memory = memory.filter((m) => !ids.has(m.clientId)));
  await Promise.all(entries.map((e) => tx("readwrite", (s) => s.delete(e.seq as number))));
}

async function refreshCount() {
  const list = await all().catch(() => memory);
  setPending(list.filter((e) => e.staffId === me).length);
}

/** Who is signed in on this device; their queued actions are the ones we send. */
export function setOutboxUser(staffId: string | null) {
  me = staffId;
  void refreshCount().then(flush);
}

/** Queue an action and try to send it straight away. Returns at once; the UI updates optimistically. */
export async function send(command: Command, clientId = newClientId()): Promise<void> {
  if (!me) throw new Error("Not signed in");
  const queued = add({ clientId, clientTs: new Date().toISOString(), command, staffId: me }).then(refreshCount);
  track(queued.then(flush));
  await queued;
}

let flushing: Promise<void> | null = null;
let sending: Promise<unknown> = Promise.resolve();
const track = (p: Promise<unknown>) => void (sending = Promise.allSettled([sending, p]));

/**
 * Run `fn` once the actions this device is sending right now have reached the server (or failed).
 * Screens refetch through this, so a live update arriving mid-send can't flash a tap back to its old state.
 * Doesn't wait for a queue that is stuck offline: that would freeze the screen.
 */
export function afterSending(fn: () => void) {
  void Promise.allSettled([sending, flushing]).then(fn);
}

/** Send everything queued for the current person, oldest first. Stops quietly when there's no connection. */
export function flush(): Promise<void> {
  if (flushing || !me || getMode() === "offline") return flushing ?? Promise.resolve();
  flushing = (async () => {
    try {
      for (;;) {
        const mine = (await all()).filter((e) => e.staffId === me).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        if (!mine.length) break;
        const batch = mine.slice(0, BATCH);
        let res: SyncResult;
        try {
          res = await api<SyncResult>("POST", "/v1/s/sync", { commands: batch.map(({ clientId, clientTs, command }) => ({ clientId, clientTs, command })) });
        } catch (e) {
          if (e instanceof NetworkError) return; // try again when the connection is back
          if (e instanceof ApiError && (e.status === 400 || e.status === 403)) {
            // the batch itself is unacceptable (e.g. signed in with the wrong role): don't block the queue forever
            await remove(batch);
            batch.forEach((b) => rejectionListeners.forEach((l) => l({ command: b.command, reason: e.message })));
            continue;
          }
          return; // 401 (signed out) / 5xx: keep, retry later
        }
        for (const r of res.results) {
          if (r.outcome !== "REJECTED") continue;
          const b = batch.find((x) => x.clientId === r.clientId);
          if (b) rejectionListeners.forEach((l) => l({ command: b.command, reason: r.reason ?? "Refused" }));
        }
        await remove(batch);
        await refreshCount();
        flushedListeners.forEach((l) => l());
      }
    } finally {
      flushing = null;
      await refreshCount();
    }
  })();
  return flushing;
}

/** A queued action the server refused (e.g. someone else already served that dish). */
export function onRejected(fn: (r: Rejection) => void) {
  rejectionListeners.add(fn);
  return () => void rejectionListeners.delete(fn);
}

/** Fires after queued actions reached the server: screens refetch. */
export function onFlushed(fn: () => void) {
  flushedListeners.add(fn);
  return () => void flushedListeners.delete(fn);
}

let started = false;
export function startOutbox() {
  if (started || typeof window === "undefined") return;
  started = true;
  onModeChange((m) => m !== "offline" && void flush());
  setInterval(() => void flush(), 5_000);
}
