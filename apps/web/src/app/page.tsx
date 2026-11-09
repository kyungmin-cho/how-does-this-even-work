import { redirect } from "next/navigation";

import { DEFAULT_PRODUCT_SLUG } from "@/lib/products";

// A plain redirect, nothing to prerender.
export const instant = false;

export default function Home() {
  redirect(`/studio/${DEFAULT_PRODUCT_SLUG}`);
}
