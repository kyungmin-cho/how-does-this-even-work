"use client";

import type { Product } from "@assembly/engine/schema";
import { useSyncExternalStore } from "react";

import { getProduct } from "@/lib/products";
import { useAppStore } from "@/store";

/** The product currently open in the studio (parsed once per slug). */
export function useProduct(): Product | null {
  const slug = useAppStore((s) => s.productSlug);
  return slug ? getProduct(slug) : null;
}

const MOBILE_QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

/** Phone-sized screen. False on the server. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
