import { describe, expect, it } from "vitest";
import {
  createMessageId,
  createPartId,
  createProjectId,
  createSessionId,
  type ModelId,
  type ModelProviderId,
} from "@zcode/contracts";
import { createSqliteSessionStore } from "../src/storage/index.js";

function createSession(store: ReturnType<typeof createSqliteSessionStore>, slug: string) {
  const sessionID = createSessionId(slug);
  return store
    .createSession({
      id: sessionID,
      projectID: createProjectId("purge-project"),
      slug,
      directory: "/workspace/purge",
      path: "/workspace/purge",
      title: slug,
      version: "0.1.0",
      time: { created: 1_000, updated: 1_000 },
    })
    .then(() => sessionID);
}

async function seedConversation(
  store: ReturnType<typeof createSqliteSessionStore>,
  sessionID: ReturnType<typeof createSessionId>,
) {
  const messageID = createMessageId(`${sessionID}-message`);
  await store.saveMessage({
    id: messageID,
    sessionID,
    role: "user",
    time: { created: 1_001 },
    agent: "zcode-agent",
    model: {
      providerID: "test-provider" as ModelProviderId,
      modelID: "test-model" as ModelId,
    },
  });
  await store.savePart({
    id: createPartId(`${sessionID}-part`),
    sessionID,
    messageID,
    type: "text",
    text: "hello archive",
    time: { start: 1_001, end: 1_002 },
  });
  await store.saveSessionEntry?.({
    id: `${sessionID}-entry`,
    sessionID,
    type: "turn_usage",
    time: { created: 1_003, updated: 1_003 },
    data: { tokens: 1 },
  });
  await store.saveSessionInput?.({
    id: `${sessionID}-input`,
    sessionID,
    kind: "text",
    delivery: "queue",
    payload: { text: "queued" },
  });
  await store.upsertTurnUsage({
    sessionID,
    turnID: `${sessionID}-turn` as never,
    status: "completed",
    startedAt: 1_004,
    inputTokens: 1,
  });
  return { messageID };
}

describe("sqlite session store purgeSession", () => {
  it("removes only the target session and its full archive", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const targetID = await createSession(store, "purge-target");
    const survivorID = await createSession(store, "purge-survivor");
    await seedConversation(store, targetID);
    await seedConversation(store, survivorID);

    const result = await store.purgeSession!({ sessionID: targetID });

    expect(result.sessionFound).toBe(true);
    expect(result.deletedMessages).toBe(1);
    expect(result.deletedParts).toBe(1);
    await expect(store.getSession(targetID)).resolves.toBeNull();
    await expect(store.messages({ sessionID: targetID })).resolves.toEqual([]);
    await expect(store.listSessionInputs!({ sessionID: targetID })).resolves.toEqual([]);

    // 另一个会话及其消息必须原样保留。
    await expect(store.getSession(survivorID)).resolves.not.toBeNull();
    await expect(store.messages({ sessionID: survivorID })).resolves.toHaveLength(1);
    await expect(store.listSessionInputs!({ sessionID: survivorID })).resolves.toHaveLength(1);
    store.close();
  });

  it("returns sessionFound=false but still clears orphan rows", async () => {
    const store = createSqliteSessionStore({ dbPath: ":memory:" });
    const orphanID = createSessionId("purge-orphan");

    const result = await store.purgeSession!({ sessionID: orphanID });

    expect(result).toMatchObject({
      sessionFound: false,
      deletedMessages: 0,
      deletedParts: 0,
    });
    store.close();
  });
});
