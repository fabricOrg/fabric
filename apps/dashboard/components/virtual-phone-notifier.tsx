"use client";

import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getVirtualPhone } from "@/lib/client/dashboard-api";

/**
 * Topbar virtual-phone indicator. Polls the inbox and, when a new message lands (unread count rises),
 * buzzes the icon + plays a short buzz + vibrates (mobile). The badge shows unread; clicking opens the
 * virtual phone. Poll pauses on a hidden tab and keeps last-known-good on a transient failure — the
 * indicator must never be the reason a page feels broken.
 */
export function VirtualPhoneNotifier() {
  const { data } = useQuery({
    queryKey: ["virtual-phone-notifier"],
    queryFn: () => getVirtualPhone(),
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });

  const unread = data
    ? data.messages.filter((m) => !m.read_at && !m.erased).length
    : 0;

  const [buzzing, setBuzzing] = useState(false);
  const previous = useRef<number | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!data) return;
    // Only react once a baseline is set — the first load isn't a "new message" event.
    if (previous.current !== null && unread > previous.current) {
      setBuzzing(true);
      const timer = setTimeout(() => setBuzzing(false), 700);
      playBuzz(audioCtx);
      navigator.vibrate?.([40, 30, 40]);
      previous.current = unread;
      return () => clearTimeout(timer);
    }
    previous.current = unread;
  }, [unread, data]);

  const label =
    unread > 0
      ? `Virtual phone — ${unread} unread message${unread === 1 ? "" : "s"}`
      : "Virtual phone";

  return (
    <Link
      href="/virtual-phone"
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Smartphone className={buzzing ? "size-5 vp-buzz" : "size-5"} />
      {unread > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white tabular-nums shadow-sm">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

/** Short two-pulse buzz via the Web Audio API — no asset, CSP-safe. Silent (never throws) if the
 *  browser blocks audio until a user gesture; the visual buzz + badge still fire. */
function playBuzz(ref: { current: AudioContext | null }) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!ref.current) ref.current = new Ctx();
    const ctx = ref.current;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    for (const start of [0, 0.16]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.06, now + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + start + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.13);
    }
  } catch {
    // audio unavailable — visual buzz still conveys the event
  }
}
