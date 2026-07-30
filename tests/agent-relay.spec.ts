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

  const heartbeat = await agent.post("/api/agent/heartbeat", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(heartbeat.ok()).toBeTruthy();

  const events = await request.get(`/api/agent/events?job=${encodeURIComponent(jobId)}&cursor=0`);
  expect(events.ok()).toBeTruthy();
  expect((await events.json()).events.map((event: { type: string }) => event.type)).toEqual(["text", "done"]);

  const stranger = await playwrightRequest.newContext({ baseURL });
  const hidden = await stranger.get(`/api/agent/events?job=${encodeURIComponent(jobId)}&cursor=0`);
  expect(hidden.status()).toBe(404);
  await stranger.dispose();

  const disconnected = await agent.post("/api/agent/disconnect", { data: { token } });
  expect(disconnected.ok()).toBeTruthy();
  const rejectedWhileOffline = await request.post("/api/agent/enqueue", {
    data: {
      job: {
        id: `offline-${nonce}`,
        conversationId,
        workspaceId: conversationId,
        prompt: "Continue",
        history: [],
      },
    },
  });
  expect(rejectedWhileOffline.status()).toBe(410);
  await expect(rejectedWhileOffline.json()).resolves.toMatchObject({ reason: "offline" });

  // A real launcher heartbeat immediately restores truthful presence after a
  // transient disconnect marker.
  expect((await agent.post("/api/agent/heartbeat", {
    headers: { Authorization: `Bearer ${token}` },
  })).ok()).toBeTruthy();
  const restored = await request.post("/api/agent/enqueue", {
    data: {
      job: {
        id: `restored-${nonce}`,
        conversationId,
        workspaceId: conversationId,
        prompt: "Continue",
        history: [],
      },
    },
  });
  expect(restored.ok()).toBeTruthy();
  await agent.dispose();
});

test("terminal-initiated device pairing is pending until browser approval", async ({ request, baseURL }) => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const agent = await playwrightRequest.newContext({ baseURL });
  const started = await agent.post("/api/agent/device/start", {
    data: {
      agent: {
        protocol: 3,
        version: "1.2.0-test",
        host: "device-flow-test",
        platform: "win32",
        node: process.version,
        claude: true,
        codex: true,
        git: true,
        gh: true,
        engine: "claude+codex",
        workspaceRoot: "C:\\Users\\test\\Hyzr",
        permissionMode: "full-access",
      },
    },
  });
  expect(started.ok()).toBeTruthy();
  const flow = await started.json();
  expect(flow.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  expect(flow.deviceSecret.length).toBeGreaterThan(30);
  expect(flow.verificationUriComplete).toContain(encodeURIComponent(flow.userCode));

  const pending = await agent.post("/api/agent/device/token", { data: { deviceSecret: flow.deviceSecret } });
  expect(pending.status()).toBe(202);
  await expect(pending.json()).resolves.toMatchObject({ status: "authorization_pending" });

  const signup = await request.post("/api/auth/signup", {
    data: { email: `device-${nonce}@example.test`, password: `hyzr-device-${nonce}` },
  });
  expect(signup.ok()).toBeTruthy();
  const inspected = await request.get(`/api/agent/device/approve?code=${encodeURIComponent(flow.userCode)}`);
  expect(inspected.ok()).toBeTruthy();
  await expect(inspected.json()).resolves.toMatchObject({
    status: "pending",
    agent: { host: "device-flow-test", protocol: 3, permissionMode: "full-access" },
  });

  const approved = await request.post("/api/agent/device/approve", { data: { code: flow.userCode } });
  expect(approved.ok()).toBeTruthy();
  const approvalPayload = await approved.json();
  expect(approvalPayload).toMatchObject({ ok: true, protocol: 3 });
  expect(approvalPayload.token).toBeUndefined();

  const exchanged = await agent.post("/api/agent/device/token", { data: { deviceSecret: flow.deviceSecret } });
  expect(exchanged.ok()).toBeTruthy();
  const { token } = await exchanged.json();
  expect(token).toMatch(/^[a-f0-9]{48}$/);

  const heartbeat = await agent.post("/api/agent/heartbeat", { headers: { Authorization: `Bearer ${token}` } });
  expect(heartbeat.ok()).toBeTruthy();
  const firstJobId = `device-job-${nonce}`;
  expect((await request.post("/api/agent/enqueue", { data: { job: {
    id: firstJobId, conversationId: firstJobId, workspaceId: firstJobId,
    prompt: "Verify device pairing", history: [],
  } } })).ok()).toBeTruthy();
  const firstPoll = await agent.get("/api/agent/poll", { headers: { Authorization: `Bearer ${token}` } });
  await expect(firstPoll.json()).resolves.toMatchObject({ job: { id: firstJobId } });

  // Approving a replacement computer is deterministic. A late heartbeat from
  // the old launcher must not steal the account mapping back.
  const replacementStart = await agent.post("/api/agent/device/start", {
    data: { agent: {
      protocol: 3, version: "1.2.0-test", host: "replacement-device",
      platform: "win32", node: process.version, claude: false, codex: true,
      git: true, gh: true, engine: "codex", workspaceRoot: "C:\\Hyzr",
      permissionMode: "full-access",
    } },
  });
  const replacementFlow = await replacementStart.json();
  expect((await request.post("/api/agent/device/approve", { data: { code: replacementFlow.userCode } })).ok()).toBeTruthy();
  const replacementExchange = await agent.post("/api/agent/device/token", { data: { deviceSecret: replacementFlow.deviceSecret } });
  const replacementToken = (await replacementExchange.json()).token;
  expect((await agent.post("/api/agent/heartbeat", { headers: { Authorization: `Bearer ${replacementToken}` } })).ok()).toBeTruthy();
  expect((await agent.post("/api/agent/heartbeat", { headers: { Authorization: `Bearer ${token}` } })).ok()).toBeTruthy();
  const replacementJobId = `replacement-job-${nonce}`;
  expect((await request.post("/api/agent/enqueue", { data: { job: {
    id: replacementJobId, conversationId: replacementJobId, workspaceId: replacementJobId,
    prompt: "Verify replacement pairing", history: [],
  } } })).ok()).toBeTruthy();
  const replacementPoll = await agent.get("/api/agent/poll", { headers: { Authorization: `Bearer ${replacementToken}` } });
  await expect(replacementPoll.json()).resolves.toMatchObject({ job: { id: replacementJobId } });
  await agent.dispose();
});
