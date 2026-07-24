import {
  type CreateSmsTemplateRequest,
  listSmsTemplatesResponse,
  type SmsTemplate,
  smsTemplate,
  type UpdateSmsTemplateRequest,
} from "@app/contracts";

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = response.status === 204 ? undefined : await response.json();
  if (!response.ok) throw payload;
  return payload;
}

export async function listSmsTemplates(): Promise<SmsTemplate[]> {
  const result = listSmsTemplatesResponse.parse(
    await request("/api/dashboard/sms/templates"),
  );
  return result.templates;
}

export async function createSmsTemplate(
  input: CreateSmsTemplateRequest,
): Promise<SmsTemplate> {
  return smsTemplate.parse(
    await request("/api/dashboard/sms/templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function updateSmsTemplate(
  id: string,
  input: UpdateSmsTemplateRequest,
): Promise<SmsTemplate> {
  return smsTemplate.parse(
    await request(`/api/dashboard/sms/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteSmsTemplate(id: string): Promise<void> {
  await request(`/api/dashboard/sms/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
