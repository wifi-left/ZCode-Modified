import type { DatabaseSync } from "node:sqlite";
import type { SessionId, SessionPurgeResult } from "@zcode/contracts";

/**
 * 永久删除会话归档。
 *
 * 显式按依赖顺序删除，不依赖 `pragma foreign_keys` 是否开启：
 * - part → message（part 只按 session_id 索引，message 删除的 cascade 不兜底）
 * - session_entry / session_input / todo / session_target / session_task_link
 * - model_usage / turn_usage / tool_usage
 * - input_history（可空的 session_id，无 FK）
 * - dwf_run（parent_session_id 是纯 text，无 FK；cascade 带走 actor/node/event）
 * - session 行本身
 *
 * 事务内完成，任何一步失败都回滚，避免删一半留下不可恢复的残骸。
 */
export function purgeSession(
  db: DatabaseSync,
  input: { sessionID: SessionId },
): SessionPurgeResult {
  const sessionID = String(input.sessionID);
  const sessionFound = Boolean(
    db.prepare("select 1 as present from session where id = ?").get(sessionID),
  );
  const count = (sql: string): number => {
    const result = db.prepare(sql).run(sessionID);
    return Number(result.changes ?? 0);
  };

  db.exec("begin immediate");
  try {
    const deletedParts = count("delete from part where session_id = ?");
    const deletedMessages = count("delete from message where session_id = ?");
    const deletedEntries = count("delete from session_entry where session_id = ?");
    const deletedInputs = count("delete from session_input where session_id = ?");
    const deletedTodos = count("delete from todo where session_id = ?");
    const deletedUsageRows =
      count("delete from model_usage where session_id = ?") +
      count("delete from turn_usage where session_id = ?") +
      count("delete from tool_usage where session_id = ?");
    count("delete from session_target where session_id = ?");
    count("delete from session_task_link where child_session_id = ?");
    count("delete from input_history where session_id = ?");
    // 直接启动的 workflow run 以 session 为 parent；cascade 删除 actor/node/event。
    count("delete from dwf_run where parent_session_id = ?");
    if (sessionFound) count("delete from session where id = ?");
    db.exec("commit");
    return {
      sessionFound,
      deletedMessages,
      deletedParts,
      deletedEntries,
      deletedInputs,
      deletedTodos,
      deletedUsageRows,
    };
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
