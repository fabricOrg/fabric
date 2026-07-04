import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { developmentAuthConfig, workosAuthConfigured } from "@/lib/server/auth";

export default function LoginPage() {
  const workosEnabled = workosAuthConfigured();
  const developmentEnabled = developmentAuthConfig().enabled;
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LockKeyhole className="size-4" />
          </div>
          <CardTitle className="font-display text-xl">Fabric</CardTitle>
          <CardDescription>Sign in to your customer workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {workosEnabled ? (
            <Button asChild className="w-full">
              <Link href="/auth/login">Continue with WorkOS</Link>
            </Button>
          ) : null}
          {developmentEnabled ? (
            <form action="/auth/development" method="post">
              <Button className="w-full" type="submit" variant="outline">
                Development workspace
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
