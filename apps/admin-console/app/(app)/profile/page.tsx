import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ProfileView } from "@app/ui/components/ui/profile-view";
import { requireAdminSession } from "@/lib/server/auth";

export default async function ProfilePage() {
  const session = await requireAdminSession();
  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Profile</PageHeaderTitle>
          <PageHeaderDescription>
            Your staff identity and access level.
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
