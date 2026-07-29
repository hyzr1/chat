import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function linear(key: string, query: string, variables: Record<string, unknown> = {}) {
  if (!key) throw new Error("Add a Linear API key in Settings > Connections");
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || `Linear returned ${response.status}`);
  return payload.data;
}

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-linear-key") || process.env.LINEAR_API_KEY || "";
  const action = req.nextUrl.searchParams.get("action") || "issues";
  try {
    if (action === "status") {
      const data = await linear(key, `query { viewer { id name email } organization { id name urlKey } }`);
      return NextResponse.json({ connected: true, viewer: data.viewer, organization: data.organization });
    }
    if (action === "issues") {
      const data = await linear(key, `query VmxIssues($first: Int!) {
        issues(first: $first, orderBy: updatedAt) {
          nodes { id identifier title description url priority updatedAt state { id name type color } team { id name key } labels { nodes { id name color } } }
        }
      }`, { first: 60 });
      const issues = (data.issues?.nodes || []).filter((issue: any) => !["completed", "canceled"].includes(issue.state?.type));
      return NextResponse.json({ issues });
    }
    return NextResponse.json({ error: "Unknown Linear action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ connected: false, error: error?.message || "Linear request failed" }, { status: 500 });
  }
}
