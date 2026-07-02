import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Users } from "lucide-react";

export default function TeamPage() {
  return (
    <Empty className="mx-auto max-w-2xl">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Users />
        </EmptyMedia>
        <EmptyTitle>Team</EmptyTitle>
        <EmptyDescription>
          Members and roles (owner / admin / member), invites, and the multi-org
          switcher land in the next slice.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
