import {
  PageHeader,
  PageHeaderBack,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { NewCampaignForm } from "@/components/forms/new-campaign-form";

export default function NewCampaignPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderBack asChild>
            <Link href="/campaigns">
              <ArrowLeft />
              Campaigns
            </Link>
          </PageHeaderBack>
          <PageHeaderTitle>New campaign</PageHeaderTitle>
          <PageHeaderDescription>
            Send one message to a whole audience. The cost is exact and shown
            before you confirm.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <NewCampaignForm />
    </div>
  );
}
