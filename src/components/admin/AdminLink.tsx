"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/** Admin lists can contain dozens of expensive dynamic pages. Never fan out
 * viewport prefetches for them; explicit navigation still uses the client router.
 */
export function AdminLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} prefetch={false} />;
}
