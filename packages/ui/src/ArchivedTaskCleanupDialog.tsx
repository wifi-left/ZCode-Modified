import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  collectArchivedTaskCleanupCandidates,
  purgeArchivedTaskSelection,
  type ArchivedTaskCleanupCandidate,
  type ArchivedTaskCleanupSelection,
  type ArchivedTaskCleanupTarget,
  type ArchivedTaskCleanupWorkspace,
} from "@/lib/archivedTaskCleanup.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { formatBytes } from "@/resource-manager/resourceUsageView.js";

/**
 * 「清理本地存档」的勾选列表。
 * 只提交用户勾选的归档会话；永久删除 CLI 消息库内容 + 遗留快照，完成后回报释放空间。
 */
export function ArchivedTaskCleanupDialog({
  open,
  onOpenChange,
  workspaces,
  onPurged,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: ArchivedTaskCleanupWorkspace[];
  onPurged: (target: ArchivedTaskCleanupTarget) => void;
  onRefresh?: () => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<ArchivedTaskCleanupSelection | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setQuery("");
    setSelectedKeys(new Set());
    setResultMessage(null);
    void collectArchivedTaskCleanupCandidates(workspaces)
      .then((next) => {
        if (!cancelled) setSelection(next);
      })
      .catch((error: unknown) => {
        logger.error("[ArchivedTaskCleanup] 读取归档列表失败", error);
        if (!cancelled) setSelection(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // workspaces 是每次渲染新建的数组；以序列化身份作为重载边界，避免打开期间反复重扫。
  }, [open, workspaces.map((workspace) => workspace.workspacePath).join("\u0000")]);

  const filtered = useMemo(() => {
    const candidates = selection?.candidates ?? [];
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.task.title.toLocaleLowerCase().includes(normalized) ||
        candidate.workspaceLabel.toLocaleLowerCase().includes(normalized),
    );
  }, [query, selection]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ArchivedTaskCleanupCandidate[]>();
    for (const candidate of filtered) {
      const list = groups.get(candidate.workspaceLabel) ?? [];
      list.push(candidate);
      groups.set(candidate.workspaceLabel, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((candidate) => selectedKeys.has(candidate.key));

  const toggle = useCallback((candidate: ArchivedTaskCleanupCandidate) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(candidate.key)) next.delete(candidate.key);
      else next.add(candidate.key);
      return next;
    });
  }, []);

  const toggleAllFiltered = useCallback(() => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const candidate of filtered) next.delete(candidate.key);
      } else {
        for (const candidate of filtered) next.add(candidate.key);
      }
      return next;
    });
  }, [allFilteredSelected, filtered]);

  const handlePurge = useCallback(async () => {
    if (!selection || busy) return;
    if (selectedKeys.size === 0) {
      setResultMessage(intl.formatMessage({ id: "taskList.cleanupArchivedNone" }));
      return;
    }
    const confirmed = await confirmDialog({
      title: intl.formatMessage(
        { id: "taskList.cleanupArchivedConfirmTitle" },
        { count: selectedKeys.size },
      ),
      description: intl.formatMessage({ id: "taskList.cleanupArchivedConfirmDescription" }),
      confirmLabel: intl.formatMessage({ id: "taskList.cleanupArchivedConfirm" }),
      confirmVariant: "destructive",
    });
    if (!confirmed) return;
    setBusy(true);
    setResultMessage(null);
    try {
      const result = await purgeArchivedTaskSelection(
        workspaces,
        selection,
        selectedKeys,
        onPurged,
      );
      const unavailable =
        result.unavailableWorkspaces.length > 0
          ? intl.formatMessage(
              { id: "taskList.cleanupArchivedUnavailable" },
              { projects: result.unavailableWorkspaces.join("、") },
            )
          : "";
      setResultMessage(
        [
          intl.formatMessage(
            { id: "taskList.cleanupArchivedResult" },
            {
              purged: result.purged,
              skipped: result.skipped,
              failed: result.failed,
              size: formatBytes(result.freedBytes),
            },
          ),
          unavailable,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      // 让列表立刻反映已清理项；失败/跳过的项保留以便重试。
      const purgedKeys = new Set(result.purgedKeys);
      setSelection((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter((candidate) => !purgedKeys.has(candidate.key)),
            }
          : current,
      );
      setSelectedKeys((current) => {
        const next = new Set(current);
        for (const key of purgedKeys) next.delete(key);
        return next;
      });
      await onRefresh?.();
    } catch (error) {
      logger.error("[ArchivedTaskCleanup] 清理失败", error);
      setResultMessage(intl.formatMessage({ id: "taskList.cleanupArchivedError" }));
    } finally {
      setBusy(false);
    }
  }, [busy, confirmDialog, intl, onPurged, onRefresh, selectedKeys, selection, workspaces]);

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        className="flex max-h-[80vh] w-full max-w-xl flex-col gap-3"
        data-testid="archived-cleanup-dialog"
      >
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "taskList.cleanupArchivedTitle" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "taskList.cleanupArchivedDescription" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={intl.formatMessage({ id: "taskList.cleanupArchivedSearch" })}
              className="pl-8"
              data-testid="archived-cleanup-search"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || filtered.length === 0}
            onClick={toggleAllFiltered}
            data-testid="archived-cleanup-toggle-all"
          >
            {intl.formatMessage({
              id: allFilteredSelected
                ? "taskList.cleanupArchivedClearAll"
                : "taskList.cleanupArchivedSelectAll",
            })}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-card-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-ui-base text-foreground-subtle">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "taskList.cleanupArchivedLoading" })}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "taskList.cleanupArchivedEmpty" })}
            </div>
          ) : (
            grouped.map(([workspaceLabel, candidates]) => (
              <section key={workspaceLabel}>
                <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-1.5 text-ui-caption font-medium text-foreground-subtle">
                  {workspaceLabel}
                </div>
                <ul>
                  {candidates.map((candidate) => {
                    const checked = selectedKeys.has(candidate.key);
                    return (
                      <li
                        key={candidate.key}
                        className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-surface-hover"
                        onClick={() => toggle(candidate)}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={busy}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() => toggle(candidate)}
                          aria-label={candidate.task.title}
                          data-testid={`archived-cleanup-checkbox-${candidate.task.taskId}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
                          {candidate.task.title || intl.formatMessage({ id: "taskList.untitled" })}
                        </span>
                        <span className="shrink-0 text-ui-caption text-foreground-subtle">
                          {formatTaskRelativeTime(candidate.task.updatedAt, intl)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {resultMessage ? (
          <p
            role="status"
            className="min-w-0 whitespace-pre-line break-words text-ui-sm text-foreground-subtle"
          >
            {resultMessage}
          </p>
        ) : null}

        <DialogFooter className="items-center justify-between gap-2 sm:justify-between">
          <span className="text-ui-base text-foreground-subtle" data-testid="archived-cleanup-count">
            {intl.formatMessage(
              { id: "taskList.cleanupArchivedSelected" },
              { count: selectedKeys.size },
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || selectedKeys.size === 0}
              onClick={() => void handlePurge()}
              data-testid="archived-cleanup-confirm"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {intl.formatMessage(
                { id: busy ? "taskList.cleanupArchivedBusy" : "taskList.cleanupArchivedConfirm" },
                { count: selectedKeys.size },
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
