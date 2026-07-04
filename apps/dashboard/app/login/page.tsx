import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { LockKeyhole } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LockKeyhole className="size-4" />
          </div>
          <CardTitle className="font-display text-xl">Fabric local</CardTitle>
          <CardDescription>
            Open the seeded development workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/auth/development" method="post">
            <Button className="w-full" type="submit">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
