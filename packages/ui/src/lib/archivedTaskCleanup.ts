import type { IZCodeTaskService } from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import { logger } from "@/logger.js";

export interface ArchivedTaskCleanupWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
  label: string;
  service?: Pick<IZCodeTaskService, "listArchivedTasks" | "purgeArchivedTasks">;
}

export interface ArchivedTaskCleanupCandidate {
  /** `${workspaceKey}:${taskId}`，选择态与跨工作区列表共用。 */
  key: string;
  task: ZCodeTaskMeta;
  workspacePath: string;
  workspaceIdentity?: string;
  workspaceLabel: string;
}

export interface ArchivedTaskCleanupTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export interface ArchivedTaskCleanupSelection {
  candidates: ArchivedTaskCleanupCandidate[];
  unavailableWorkspaces: string[];
}

export interface ArchivedTaskCleanupResult {
  purged: number;
  skipped: number;
  failed: number;
  freedBytes: number;
  /** 已成功清理的候选 key；失败/跳过的项保留在列表里允许重试。 */
  purgedKeys: string[];
  unavailableWorkspaces: string[];
}

function candidateKey(workspacePath: string, workspaceIdentity: string | undefined, taskId: string) {
  return `${buildTaskWorkspaceKey(workspacePath, workspaceIdentity)}:${taskId}`;
}

/** 读取所有工作区的归档会话，供清理弹窗的勾选列表使用；读取失败的源单独报告。 */
export async function collectArchivedTaskCleanupCandidates(
  workspaces: ArchivedTaskCleanupWorkspace[],
): Promise<ArchivedTaskCleanupSelection> {
  const unique = new Map(
    workspaces.map((workspace) => [
      buildTaskWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity),
      workspace,
    ]),
  );
  const results = await Promise.all(
    [...unique.values()].map(async (workspace) => {
      if (!workspace.service) return { workspace, candidates: null };
      try {
        const tasks = await workspace.service.listArchivedTasks({
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
        });
        const candidates = [...new Map(tasks.map((task) => [task.taskId, task])).values()].map(
          (task): ArchivedTaskCleanupCandidate => ({
            key: candidateKey(workspace.workspacePath, workspace.workspaceIdentity, task.taskId),
            task,
            workspacePath: workspace.workspacePath,
            ...(workspace.workspaceIdentity
              ? { workspaceIdentity: workspace.workspaceIdentity }
              : {}),
            workspaceLabel: workspace.label,
          }),
        );
        return { workspace, candidates };
      } catch (error) {
        logger.warn("[ArchivedTaskCleanup] 读取归档项目失败", {
          workspaceKey: buildTaskWorkspaceKey(
            workspace.workspacePath,
            workspace.workspaceIdentity,
          ),
          error,
        });
        return { workspace, candidates: null };
      }
    }),
  );
  return {
    candidates: results
      .flatMap((result) => result.candidates ?? [])
      .sort((left, right) => right.task.updatedAt - left.task.updatedAt),
    unavailableWorkspaces: results
      .filter((result) => result.candidates === null)
      .map((result) => result.workspace.label),
  };
}

/** 按工作区批量调用永久清理；只提交勾选中的会话。 */
export async function purgeArchivedTaskSelection(
  workspaces: ArchivedTaskCleanupWorkspace[],
  selection: ArchivedTaskCleanupSelection,
  selectedKeys: ReadonlySet<string>,
  onPurged: (target: ArchivedTaskCleanupTarget) => void,
): Promise<ArchivedTaskCleanupResult> {
  const grouped = new Map<
    string,
    { workspace: ArchivedTaskCleanupWorkspace; targets: ArchivedTaskCleanupTarget[] }
  >();
  for (const candidate of selection.candidates) {
    if (!selectedKeys.has(candidate.key)) continue;
    const workspaceKey = buildTaskWorkspaceKey(
      candidate.workspacePath,
      candidate.workspaceIdentity,
    );
    const group = grouped.get(workspaceKey) ?? {
      workspace:
        workspaces.find(
          (workspace) =>
            buildTaskWorkspaceKey(workspace.workspacePath, workspace.workspaceIdentity) ===
            workspaceKey,
        ) ?? {
          workspacePath: candidate.workspacePath,
          workspaceIdentity: candidate.workspaceIdentity,
          label: candidate.workspaceLabel,
        },
      targets: [],
    };
    group.targets.push({
      workspacePath: candidate.workspacePath,
      ...(candidate.workspaceIdentity
        ? { workspaceIdentity: candidate.workspaceIdentity }
        : {}),
      taskId: candidate.task.taskId,
    });
    grouped.set(workspaceKey, group);
  }

  let purged = 0;
  let skipped = 0;
  let failed = 0;
  let freedBytes = 0;
  const purgedKeyByTask = new Map(
    selection.candidates
      .filter((candidate) => selectedKeys.has(candidate.key))
      .map((candidate) => [
        `${buildTaskWorkspaceKey(candidate.workspacePath, candidate.workspaceIdentity)}:${candidate.task.taskId}`,
        candidate.key,
      ]),
  );
  const purgedKeys: string[] = [];
  await Promise.all(
    [...grouped.values()].map(async ({ workspace, targets }) => {
      if (!targets.length) return;
      if (!workspace.service?.purgeArchivedTasks) {
        failed += targets.length;
        return;
      }
      try {
        const result = await workspace.service.purgeArchivedTasks({
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
          taskIds: targets.map((target) => target.taskId),
        });
        purged += result.purgedTaskIds.length;
        skipped += result.skippedTaskIds.length;
        failed += result.failedTaskIds.length;
        freedBytes += result.freedBytes;
        for (const target of targets) {
          if (!result.purgedTaskIds.includes(target.taskId)) continue;
          onPurged(target);
          const key =
            purgedKeyByTask.get(
              `${buildTaskWorkspaceKey(target.workspacePath, target.workspaceIdentity)}:${target.taskId}`,
            ) ?? `${buildTaskWorkspaceKey(target.workspacePath, target.workspaceIdentity)}:${target.taskId}`;
          purgedKeys.push(key);
        }
      } catch (error) {
        failed += targets.length;
        logger.warn("[ArchivedTaskCleanup] 工作区批次清理失败", {
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
          error,
        });
      }
    }),
  );
  return {
    purged,
    skipped,
    failed,
    freedBytes,
    purgedKeys,
    unavailableWorkspaces: selection.unavailableWorkspaces,
  };
}
