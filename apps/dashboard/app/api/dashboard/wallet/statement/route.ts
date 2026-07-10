// Statement download (B1): proxies /v1/wallet/statement as a CSV attachment. Query params
// (from/to/currency) pass through; identity + tenant come from the session, never the client.

import { NextResponse } from "next/server";
import { BffError, dashboardApiRaw } from "@/lib/server/api-client";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const upstreamPath = `/v1/wallet/statement${incoming.search}`;
  try {
    const upstream = await dashboardApiRaw(upstreamPath, "wallet:read");
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "content-disposition":
          upstream.headers.get("content-disposition") ??
          'attachment; filename="fabric-statement.csv"',
      },
    });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : NextResponse.json(
          {
            error: {
              type: "api_error",
              code: "bff_error",
              message: "Statement export failed.",
            },
          },
          { status: 500 },
        );
  }
}
