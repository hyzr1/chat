import { expect, request as playwrightRequest, test } from "@playwright/test";

test("paired relay preserves workspace identity and scopes results to the account", async ({ request, baseURL }) => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `relay-${nonce}@example.test`;
  const signup = await request.post("/api/auth/signup", { data: { email, password: `hyzr-relay-${nonce}` } });
  expect(signup.ok()).toBeTruthy();

  const codeResponse = await request.post("/api/agent/code", { data: {} });
  expect(codeResponse.ok()).toBeTruthy();
  const { code } = await codeResponse.json();

  const agent = await playwrightRequest.newContext({ baseURL });
  const paired = await agent.post("/api/agent/pair", {
    data: {
      code,
      agent: {
        protocol: 2,
        version: "test",
        host: "relay-test",
        platform: "test",
        node: process.version,
        claude: true,
        codex: true,
        git: true,
        gh: true,
        engine: "claude+codex",
      },
    },
  });
  expect(paired.ok()).toBeTruthy();
  const { token } = await paired.json();

  const jobId = `run-${nonce}`;
  const conversationId = `chat-${nonce}`;
  const enqueued = await request.post("/api/agent/enqueue", {
    data: {
      job: {
        id: jobId,
        conversationId,
        workspaceId: conversationId,
        prompt: "Create index.html",
        history: [],
        plan: true,
      },
    },
  });
  expect(enqueued.ok()).toBeTruthy();

  const polled = await agent.get("/api/agent/poll", { headers: { Authorization: `Bearer ${token}` } });
  expect(polled.ok()).toBeTruthy();
  const { job } = await polled.json();
  expect(job.kind).toBe("run");
  expect(job.workspaceId).toBe(conversationId);
  expect(job.conversationId).toBe(conversationId);

  expect((await agent.post("/api/agent/result", { data: { token, jobId, type: "text", text: "Created index.html" } })).ok()).toBeTruthy();
  expect((await agent.post("/api/agent/result", { data: { token, jobId, type: "done" } })).ok()).toBeTruthy();

  const events = await request.get(`/api/agent/events?job=${encodeURIComponent(jobId)}&cursor=0`);
  expect(events.ok()).toBeTruthy();
  expect((await events.json()).events.map((event: { type: string }) => event.type)).toEqual(["text", "done"]);

  const stranger = await playwrightRequest.newContext({ baseURL });
  const hidden = await stranger.get(`/api/agent/events?job=${encodeURIComponent(jobId)}&cursor=0`);
  expect(hidden.status()).toBe(404);
  await stranger.dispose();
  await agent.dispose();
});
