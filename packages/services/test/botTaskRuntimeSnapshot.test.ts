import { describe, expect, it } from "vitest";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";
import {
  BOT_RUNTIME_MESSAGE_LIMIT_MAX,
  buildBotTaskRuntimeSnapshot,
  isBotTaskRuntimeActive,
} from "../src/zcode-agent/botTaskRuntimeSnapshot.js";

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId: "session-1",
    logEpoch: "epoch-1",
    seq: 12,
    revision: 7,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "assistant",
      activeWorks: [{ kind: "primaryTurn", startedAt: 1000 }],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "guard.noGoal" },
      resumeGoal: { allowed: false, reasonCode: "guard.noGoal" },
    },
    inputRouting: { mode: "enqueue" },
    meta: { title: "", titleSource: "default" },
    config: {
      provider: "glm",
      model: "glm-4.6",
      thought: "medium",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: { usedTokens: 10, maxTokens: 200000, autoCompactThresholdTokens: null },
      cumulative: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 500,
        cacheWriteTokens: 20,
      },
    },
    queue: {
      items: [
        {
          sourceCommandId: "cmd-1",
          queueItemId: "queue-1",
          clientId: "bot:weixin-1:user-1",
          kind: "sendText",
          text: "继续跑一下测试",
          attachments: [],
          delivery: { requested: "queue", admitted: "queue" },
          order: { admissionSeq: 1, queuePosition: 0 },
          steer: { state: "notRequested" },
          dispatch: { state: "queued" },
          admittedAt: 1700000000000,
        },
      ],
      autoDrain: true,
    },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    workspaceHookAdmission: null,
    rows: {
      window: [
        {
          rowId: 1,
          turnId: "turn-1",
          createdAt: 1700000000000,
          createdAtSeq: 1,
          kind: "userInput",
          origin: "realUser",
          text: "帮我修复登录",
        },
        {
          rowId: 2,
          turnId: "turn-1",
          createdAt: 1700000000001,
          createdAtSeq: 2,
          kind: "assistantText",
          text: "已修复登录逻辑",
          state: "complete",
        },
        {
          rowId: 3,
          turnId: "turn-1",
          createdAt: 1700000000002,
          createdAtSeq: 3,
          kind: "turnHeader",
          origin: "userInput",
          state: "completedSuccess",
          startedAt: 1700000000000,
          endedAt: 1700000000002,
          fileChanges: { files: 2, additions: 12, deletions: 3, state: "active" },
        },
      ],
      totalCount: 3,
      firstRowId: 1,
    },
    ...overrides,
  });
}

describe("buildBotTaskRuntimeSnapshot", () => {
  it("extracts queue, usage, messages and file changes", () => {
    const snapshot = buildBotTaskRuntimeSnapshot(makeSnapshot());

    expect(snapshot.phase).toBe("running");
    expect(snapshot.queueAutoDrain).toBe(true);
    expect(snapshot.queueItems).toEqual([
      {
        queueItemId: "queue-1",
        sourceCommandId: "cmd-1",
        text: "继续跑一下测试",
        dispatchState: "queued",
        queuePosition: 0,
        admittedAt: 1700000000000,
      },
    ]);
    expect(snapshot.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 500,
      cacheWriteTokens: 20,
    });
    expect(snapshot.recentMessages).toEqual([
      { role: "user", text: "帮我修复登录", at: 1700000000000 },
      { role: "assistant", text: "已修复登录逻辑", at: 1700000000001 },
    ]);
    expect(snapshot.fileChanges).toEqual({ files: 2, additions: 12, deletions: 3 });
    expect(isBotTaskRuntimeActive(snapshot)).toBe(true);
  });

  it("caps the message window and drops reverted file changes", () => {
    const rows = Array.from({ length: 60 }, (_value, index) => ({
      rowId: index + 1,
      turnId: "turn-1",
      createdAt: 1700000000000 + index,
      createdAtSeq: index + 1,
      kind: "assistantText" as const,
      text: `回复 ${index + 1}`,
      state: "complete" as const,
    }));
    const snapshot = buildBotTaskRuntimeSnapshot(
      makeSnapshot({
        rows: {
          window: [
            ...rows,
            {
              rowId: 99,
              turnId: "turn-2",
              createdAt: 1700000009999,
              createdAtSeq: 99,
              kind: "turnHeader",
              origin: "userInput",
              state: "completedSuccess",
              startedAt: 1700000009000,
              endedAt: 1700000009999,
              fileChanges: { files: 5, additions: 50, deletions: 9, state: "reverted" },
            },
          ],
          totalCount: rows.length + 1,
          firstRowId: 1,
        },
      }),
      500,
    );

    // 上限收敛到 BOT_RUNTIME_MESSAGE_LIMIT_MAX，且只保留最新的一条文本。
    expect(snapshot.recentMessages).toHaveLength(BOT_RUNTIME_MESSAGE_LIMIT_MAX);
    expect(snapshot.recentMessages?.at(-1)?.text).toBe("回复 60");
    expect(snapshot.fileChanges).toBeUndefined();
  });

  it("treats non-active phases as idle", () => {
    const snapshot = buildBotTaskRuntimeSnapshot(
      makeSnapshot({
        control: {
          phase: "completedSuccess",
          sessionEnded: true,
          canStop: false,
          stopState: "idle",
          stopTargetKind: "assistant",
          activeWorks: [],
          lastError: null,
          apiRetry: null,
        },
      }),
    );
    expect(isBotTaskRuntimeActive(snapshot)).toBe(false);
    expect(snapshot.phase).toBe("completedSuccess");
  });
});
