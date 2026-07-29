import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Follow-ups are intentionally deterministic. Spending a separate provider
// call after every answer costs tokens without improving the delivery itself.
export async function POST(req: NextRequest) {
  try {
    const { userPrompt, answer } = (await req.json()) as {
      userPrompt: string;
      answer: string;
    };
    const exchange = `${userPrompt}\n${answer}`;
    const followups = /(?:bug|error|broken|fix|regression|debug)/i.test(exchange)
      ? ["Show me the root cause and regression evidence", "What files changed?", "Run the narrowest relevant test again"]
      : /(?:website|web app|frontend|mobile|responsive|design|page)/i.test(exchange)
        ? ["Open the preview", "Show me the desktop and mobile verification", "What files changed?"]
        : /(?:api|server|database|backend|auth)/i.test(exchange)
          ? ["Show me the validation evidence", "Explain the failure handling", "What files changed?"]
          : ["What changed?", "Show me the verification evidence", "What would you improve next?"];
    return NextResponse.json({ followups, generation: "deterministic", providerCalls: 0 });
  } catch (e: any) {
    return NextResponse.json({ followups: [], error: e?.message });
  }
}
