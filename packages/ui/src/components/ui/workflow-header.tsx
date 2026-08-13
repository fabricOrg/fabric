import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import type * as React from "react";

function WorkflowHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <PageHeader>
      <PageHeaderHeading>
        <PageHeaderTitle>{title}</PageHeaderTitle>
        {description ? (
          <PageHeaderDescription>{description}</PageHeaderDescription>
        ) : null}
      </PageHeaderHeading>
      {actions ? <PageHeaderActions>{actions}</PageHeaderActions> : null}
    </PageHeader>
  );
}

export { WorkflowHeader };
