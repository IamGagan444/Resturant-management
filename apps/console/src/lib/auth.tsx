"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { HubPass, Me, StaffRole } from "@rms/contracts";
import { ApiError, api } from "./api";
import { getMode, saveHub } from "./net";
import { flush, setOutboxUser } from "./outbox";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("GET", "/v1/auth/me"),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Where each role lands after sign-in. */
export function homeFor(me: Me): string {
  if (me.typ === "platform") return "/platform/";
  return { OWNER: "/manage/", MANAGER: "/manage/", CASHIER: "/cashier/", COOK: "/kds/", WAITER: "/waiter/" }[me.role];
}

const PASS_REFRESH_MS = 6 * 3600_000;

/** While online, keep a fresh hub pass so an outage needs no new login. */
async function refreshHubPass() {
  if (getMode() !== "cloud") return;
  try {
    saveHub(await api<HubPass>("GET", "/v1/s/hub/pass"));
  } catch {
    // offline right now: keep the pass we have
  }
}

/**
 * Page guard. Not signed in → device PIN screen (or email login if the device isn't paired).
 * Wrong role → their own home. Returns the user once allowed.
 * During an outage a 401 from the hub doesn't sign anyone out: the cloud decides that when it's back.
 */
export function useGuard(allowed: readonly StaffRole[] | "platform"): Me | null {
  const router = useRouter();
  const me = useMe();
  const staffId = me.data?.typ === "staff" ? me.data.id : null;

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401 && getMode() === "cloud") router.replace("/device/");
    if (!me.data) return;
    const ok = allowed === "platform" ? me.data.typ === "platform" : me.data.typ === "staff" && allowed.includes(me.data.role);
    if (!ok) router.replace(homeFor(me.data));
  }, [me.data, me.error, allowed, router]);

  useEffect(() => {
    setOutboxUser(staffId);
    if (!staffId) return;
    void refreshHubPass();
    const t = setInterval(() => void refreshHubPass(), PASS_REFRESH_MS);
    return () => clearInterval(t);
  }, [staffId]);

  if (!me.data) return null;
  if (allowed === "platform") return me.data.typ === "platform" ? me.data : null;
  return me.data.typ === "staff" && allowed.includes(me.data.role) ? me.data : null;
}

/** Switch user. Queued actions are sent first, so they're credited to the person who did them. */
export async function signOut() {
  await Promise.race([flush(), new Promise((r) => setTimeout(r, 3000))]);
  await api("POST", "/v1/auth/logout").catch(() => undefined);
  saveHub(null);
  location.href = "/device/";
}
