import { describe, expect, it, vi } from "vitest";
import type { BotTaskRuntimeSnapshot, BotsStateFile } from "@zcode/shared";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import * as f from "./botsService.fixtures.js";

const actor = {
  provider: "webhook" as const,
  botId: "webhook-1",
  providerUserId: "user-1",
  chatType: "private" as const,
};

const TASK_META = {
  taskId: "task-1",
  title: "Task 1",
  workspacePath: "/tmp/workspace",
  workspaceIdentity: "ssh://host/tmp/workspace",
  provider: "glm" as const,
};

/** 已绑定 + 已进入 task 模式的服务上下文（消息流测试的公共前置）。 */
async function createBoundTaskService(options: {
  taskService?: IZCodeTaskService;
  modelSelectionService?: ReturnType<typeof f.createModelSelectionService>;
  state?: BotsStateFile;
  /** true = 本地工作区（无 workspaceIdentity），/diff 才会走本地 git 通道。 */
  localWorkspace?: boolean;
  gitChanges?: Array<{
    workspaceRelativePath: string;
    repoRelativePath: string;
    added: number;
    removed: number;
  }>;
}) {
  const repo = f.createMemoryRepo(f.baseConfig, options.state);
  const taskService = options.taskService ?? f.createLegacyTaskService();
  const service = f.createBotsService({
    credentialService: f.createCredentialService({ "secret-1": "secret" }),
    zcodeTaskService: taskService,
    ...(options.localWorkspace
      ? {
          settingService: f.createSettingService({
            locale: "zh-CN",
            lastWorkspaceSession: [{ kind: "local", workspacePath: "/tmp/workspace" }],
          }),
        }
      : {}),
    ...(options.modelSelectionService
      ? { modelSelectionService: options.modelSelectionService }
      : {}),
    ...(options.gitChanges
      ? {
          gitService: {
            // 暂存区为空：只验证未暂存改动汇总，避免同一批改动被计两次。
            getChanges: vi.fn(async (params: { sourceId: string }) =>
              params.sourceId === "unstaged" ? options.gitChanges : [],
            ),
          },
        }
      : {}),
    repo: repo as never,
  });
  const code = await service.createBindCode({ botId: "webhook-1" });
  await service.handleInboundMessage({ botId: "webhook-1", text: `/bind ${code.code}`, actor });
  await service.handleInboundMessage({ botId: "webhook-1", text: "第一条消息", actor });
  return { service, taskService, repo };
}

function queuedInputSnapshot(
  overrides: Partial<BotTaskRuntimeSnapshot> = {},
): BotTaskRuntimeSnapshot {
  return {
    phase: "running",
    stopState: "stoppable",
    queueAutoDrain: true,
    queueItems: [],
    pendingInteractionCount: 0,
    ...overrides,
  };
}

describe("botsService weixin runtime controls", () => {
  it("falls back to no explicit model instead of failing when the host cannot resolve one", async () => {
    // 模型清单为空：旧行为抛“无法解析 Submission 模型”，这里必须降级为不固定模型。
    const taskService = f.createLegacyTaskService();
    const { service } = await createBoundTaskService({
      taskService,
      modelSelectionService: f.createModelSelectionService([]),
    });

    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    const createArgs = (taskService.createTask as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as { modelSelection?: unknown };
    expect(createArgs.modelSelection).toBeUndefined();
    const sendArgs = (taskService.sendPrompt as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as { modelSelection?: unknown };
    expect(sendArgs.modelSelection).toBeUndefined();
    service.disposeAll();
  });

  it("queues a private message while the task is running instead of rejecting it", async () => {
    const taskService = f.createLegacyTaskService();
    (taskService.getTaskSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      meta: { ...TASK_META, status: "running" },
    });
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () => queuedInputSnapshot({ queueItems: [] }),
    );
    const { service } = await createBoundTaskService({ taskService });

    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "运行中追加一条",
      actor,
    });

    expect(replies[0]?.text).toContain("已加入消息队列");
    const sent = (
      taskService.sendPrompt as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }
    ).mock.calls.at(-1)?.[0];
    expect(sent?.requestedDelivery).toBe("queue");
    expect(sent?.content).toBe("运行中追加一条");
    service.disposeAll();
  });

  it("reports the queue position after enqueueing", async () => {
    const taskService = f.createLegacyTaskService();
    (taskService.getTaskSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      meta: { ...TASK_META, status: "running" },
    });
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () =>
        queuedInputSnapshot({
          queueItems: [
            {
              queueItemId: "queue-1",
              sourceCommandId: "cmd-1",
              text: "排队中",
              dispatchState: "queued",
              queuePosition: 1,
              admittedAt: 1,
            },
          ],
        }),
    );
    const { service } = await createBoundTaskService({ taskService });

    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "排在后面",
      actor,
    });
    expect(replies[0]?.text).toContain("第 1 位");
    service.disposeAll();
  });

  it("uses the live runtime phase for /status instead of a stale completed task meta", async () => {
    const taskService = f.createLegacyTaskService();
    // meta 停留在上一轮终态（completed），但 CLI 权威快照仍在 running。
    (taskService.getTaskSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      meta: { ...TASK_META, status: "completed" },
    });
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () => queuedInputSnapshot(),
    );
    const { service } = await createBoundTaskService({ taskService });

    const replies = await service.handleInboundMessage({ botId: "webhook-1", text: "/status", actor });
    expect(replies[0]?.text).toContain("运行中");
    expect(replies[0]?.text).not.toContain("已完成");
    service.disposeAll();
  });

  it("recovers /status to draft when the active session was cleaned", async () => {
    // 清理对话存档后 bot context 仍指向已删除的 session：旧行为让 getTaskConfigOptions
    // 抛 Session not found，命令被当瞬时错误反复重试，微信里持续刷过期提示。
    const taskService = f.createLegacyTaskService();
    const { service, repo } = await createBoundTaskService({ taskService });
    (taskService.getTaskSnapshot as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Session not found: task-1"),
    );
    (taskService.getTaskConfigOptions as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Session not found: task-1"),
    );

    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/status",
      actor,
    });

    expect(replies[0]?.text).not.toContain("会话已失效");
    expect(replies[0]?.text).toContain("草稿");
    const state = await repo.readState();
    expect(state.bots["webhook-1"]?.activeTaskId).toBeNull();
    expect(state.bots["webhook-1"]?.mode).toBe("draft");
    service.disposeAll();
  });

  it("lists and deletes queued inputs via /queue", async () => {
    const taskService = f.createLegacyTaskService();
    const deleteBotQueuedInput = vi.fn(async () => ({ status: "accepted" }));
    (taskService as unknown as Record<string, unknown>).deleteBotQueuedInput = deleteBotQueuedInput;
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () =>
        queuedInputSnapshot({
          queueAutoDrain: false,
          queueItems: [
            {
              queueItemId: "queue-1",
              sourceCommandId: "cmd-1",
              text: "第一条排队",
              dispatchState: "queued",
              queuePosition: 0,
              admittedAt: 1,
            },
            {
              queueItemId: "queue-2",
              sourceCommandId: "cmd-2",
              text: "第二条排队",
              dispatchState: "queued",
              queuePosition: 1,
              admittedAt: 2,
            },
          ],
        }),
    );
    const { service } = await createBoundTaskService({ taskService });

    const listReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/队列",
      actor,
    });
    expect(listReplies[0]?.text).toContain("第一条排队");
    expect(listReplies[0]?.text).toContain("第二条排队");
    expect(listReplies[0]?.text).toContain("已暂停");

    const cancelReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/队列 删除 2",
      actor,
    });
    expect(cancelReplies[0]?.text).toContain("已从队列移除");
    expect(deleteBotQueuedInput).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", queueItemId: "queue-2" }),
    );
    service.disposeAll();
  });

  it("marks running tasks in /task and allows switching while a task is running", async () => {
    const taskService = f.createLegacyTaskService();
    (taskService.listTasks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...TASK_META, status: "running" },
      { ...TASK_META, taskId: "task-2", title: "Task 2", status: "completed" },
    ]);
    (taskService.getTaskSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      meta: { ...TASK_META, status: "running" },
    });
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () => queuedInputSnapshot(),
    );
    const { service } = await createBoundTaskService({ taskService });

    const listReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/task",
      actor,
    });
    expect(listReplies[0]?.text).toContain("运行中");

    const switchReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/task task-2",
      actor,
    });
    // 旧行为在这里回“当前任务正在运行…”，现在必须真的切换并回状态。
    expect(switchReplies[0]?.text).not.toContain("正在运行，稍后再试");
    expect(switchReplies[0]?.text).toContain("Task 2");
    service.disposeAll();
  });

  it("answers /usage, /history and /result from the runtime snapshot", async () => {
    const taskService = f.createLegacyTaskService();
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () =>
        queuedInputSnapshot({
          usage: {
            inputTokens: 1200,
            outputTokens: 340,
            cacheReadTokens: 500,
            cacheWriteTokens: 20,
          },
          recentMessages: [
            { role: "user", text: "帮我修复登录", at: 1 },
            { role: "assistant", text: "已修复登录逻辑", at: 2 },
          ],
        }),
    );
    const { service } = await createBoundTaskService({ taskService });

    const usage = await service.handleInboundMessage({ botId: "webhook-1", text: "/usage", actor });
    expect(usage[0]?.text).toContain("1.2k");
    expect(usage[0]?.text).toContain("340");

    const history = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/history 5",
      actor,
    });
    expect(history[0]?.text).toContain("帮我修复登录");
    expect(history[0]?.text).toContain("已修复登录逻辑");

    const result = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/result",
      actor,
    });
    expect(result[0]?.text).toBe("已修复登录逻辑");
    service.disposeAll();
  });

  it("summarizes local git changes for /diff and falls back to turn counts", async () => {
    const taskService = f.createLegacyTaskService();
    (taskService.readBotTaskRuntimeSnapshot as unknown as ReturnType<typeof vi.fn>) = vi.fn(
      async () => queuedInputSnapshot({ fileChanges: { files: 3, additions: 9, deletions: 2 } }),
    );
    const { service } = await createBoundTaskService({
      taskService,
      localWorkspace: true,
      gitChanges: [
        { workspaceRelativePath: "src/a.ts", repoRelativePath: "src/a.ts", added: 5, removed: 1 },
        { workspaceRelativePath: "src/b.ts", repoRelativePath: "src/b.ts", added: 4, removed: 1 },
      ],
    });

    const replies = await service.handleInboundMessage({ botId: "webhook-1", text: "/diff", actor });
    expect(replies[0]?.text).toContain("2 个文件，+9 / -2");
    expect(replies[0]?.text).toContain("src/a.ts");
    service.disposeAll();
  });
});
