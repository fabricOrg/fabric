import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ProfileView } from "@app/ui/components/ui/profile-view";
import { requireDashboardSession } from "@/lib/server/auth";

export default async function ProfilePage() {
  const session = await requireDashboardSession();
  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Profile</PageHeaderTitle>
          <PageHeaderDescription>
            Your identity and workspace access.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>
      <ProfileView
        email={session.email}
        name={session.name}
        role={session.role}
      />
    </PageContainer>
  );
}
