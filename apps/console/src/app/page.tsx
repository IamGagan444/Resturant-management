"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useMe } from "@/lib/auth";
import { Spinner } from "@/components/ui";

/** Entry: send each user to their screen. */
export default function Home() {
  const router = useRouter();
  const me = useMe();
  useEffect(() => {
    if (me.data) router.replace(homeFor(me.data));
    else if (me.isError) router.replace("/device/");
  }, [me.data, me.isError, router]);
  return <Spinner />;
}
