import { redirect } from "next/navigation";

/**
 * ADR-0008: the Fabric-owned /signin page replaced this one. /login stays as the registered WorkOS
 * logout return URI (and any stale "/login" link) and forwards to /signin, preserving `?error=`.
 * The flash NOTICE cookie is same-origin, so /signin reads it after the redirect.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  redirect(error ? `/signin?error=${encodeURIComponent(error)}` : "/signin");
}
