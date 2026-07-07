"use client";

import { useRouter } from "next/navigation";
import { CreateTenantDialog } from "@/components/create-tenant-dialog";

/**
 * Thin client wrapper so the server Tenants page can drop the CreateTenantDialog into its header:
 * on a successful provision we just re-fetch the server-rendered list.
 */
export function NewTenantButton() {
  const router = useRouter();
  return <CreateTenantDialog onCreated={() => router.refresh()} />;
}
