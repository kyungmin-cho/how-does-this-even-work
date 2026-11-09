import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getProduct, PRODUCT_SLUGS } from "@/lib/products";

// Nothing renders here, and an unknown product must answer 404, so this route blocks.
export const instant = false;

export function generateStaticParams() {
  return PRODUCT_SLUGS.map((productId) => ({ productId }));
}

export async function generateMetadata({ params }: PageProps<"/studio/[productId]">): Promise<Metadata> {
  const { productId } = await params;
  const product = getProduct(productId);
  return product ? { title: product.name } : {};
}

/** The screen itself is in the studio layout; this page only checks the product exists. */
export default async function ProductPage({ params }: PageProps<"/studio/[productId]">) {
  const { productId } = await params;
  if (!getProduct(productId)) notFound();
  return null;
}
