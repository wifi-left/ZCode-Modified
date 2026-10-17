import type { BotTaskRuntimeSnapshot } from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";

/** Bot 运行态快照的相位是否代表“正在工作”（含 prewarming）。 */
export function isBotTaskRuntimeActive(snapshot: BotTaskRuntimeSnapshot | null | undefined): boolean {
  return snapshot?.phase === "running" || snapshot?.phase === "prewarming";
}

/** 最近消息回放的默认上限；超大回放会把微信消息撑爆。 */
export const BOT_RUNTIME_MESSAGE_LIMIT_DEFAULT = 20;
export const BOT_RUNTIME_MESSAGE_LIMIT_MAX = 50;

/**
 * 把 CLI 权威快照裁剪成 Bot 需要的只读摘要。
 *
 * 为什么不直接复用快照：/queue、/status、/usage、/history、/result、/diff 只需要
 * 控制相位、队列项、用量与最近文本；整份快照（rows 全窗口）经远端口传输代价过高。
 */
export function buildBotTaskRuntimeSnapshot(
  snapshot: ConversationSnapshot,
  messageLimit: number = BOT_RUNTIME_MESSAGE_LIMIT_DEFAULT,
): BotTaskRuntimeSnapshot {
  const messages: NonNullable<BotTaskRuntimeSnapshot["recentMessages"]> = [];
  let fileChanges: BotTaskRuntimeSnapshot["fileChanges"];
  for (const row of snapshot.rows.window) {
    if (row.kind === "userInput" && row.text.trim()) {
      messages.push({ role: "user", text: row.text, at: row.createdAt });
      continue;
    }
    if (row.kind === "assistantText" && row.text.trim()) {
      messages.push({ role: "assistant", text: row.text, at: row.createdAt });
      continue;
    }
    if (row.kind === "turnHeader" && row.fileChanges && row.fileChanges.state !== "reverted") {
      fileChanges = {
        files: row.fileChanges.files,
        additions: row.fileChanges.additions,
        deletions: row.fileChanges.deletions,
      };
    }
  }
  const limit = Math.max(1, Math.min(Math.trunc(messageLimit), BOT_RUNTIME_MESSAGE_LIMIT_MAX));
  return {
    phase: snapshot.control.phase,
    stopState: snapshot.control.stopState,
    queueAutoDrain: snapshot.queue.autoDrain,
    queueItems: snapshot.queue.items.map((item) => ({
      queueItemId: item.queueItemId,
      sourceCommandId: item.sourceCommandId,
      text: item.text,
      dispatchState: item.dispatch.state,
      ...(item.order.queuePosition !== undefined
        ? { queuePosition: item.order.queuePosition }
        : {}),
      admittedAt: item.admittedAt,
    })),
    pendingInteractionCount: snapshot.pendingInteractions.length,
    usage: {
      inputTokens: snapshot.usage.cumulative.inputTokens,
      outputTokens: snapshot.usage.cumulative.outputTokens,
      cacheReadTokens: snapshot.usage.cumulative.cacheReadTokens,
      cacheWriteTokens: snapshot.usage.cumulative.cacheWriteTokens,
    },
    recentMessages: messages.slice(-limit),
    ...(fileChanges ? { fileChanges } : {}),
  };
}
