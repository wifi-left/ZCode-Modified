import type {
  BuildConversationTurnRenderUnitsOptions,
  ConversationTurnRenderUnit,
} from "@/v4/conversationTurnRenderUnitTypes.js";
import type {
  ConversationRow,
  SessionPhase,
  TurnHeaderRow,
} from "@zcode/shared/zcode-protocol-v4";

/**
 * 跨帧复用未变化轮次的构建结果。
 *
 * 长会话每帧只改动最后一条流式行，但全量重建会重新 materialize 所有轮次
 * （多次 filter/map + workSegments 组装），行数一多就是持续的主线程开销。
 * 缓存只跳过“行引用、位置、运行态、折叠/插件裁决都不变”的轮次，语义与全量重建一致。
 */
export interface ConversationTurnRenderUnitsCache {
  entries: Map<string, ConversationTurnRenderUnitsCacheEntry>;
}

export interface ConversationTurnRenderUnitsCacheEntry {
  header?: TurnHeaderRow;
  rows: readonly ConversationRow[];
  optionKey: string;
  resolver: BuildConversationTurnRenderUnitsOptions["pluginUiPinResolver"];
  unit: ConversationTurnRenderUnit;
}

export function createConversationTurnRenderUnitsCache(): ConversationTurnRenderUnitsCache {
  return { entries: new Map() };
}

export function sameRowReferences(
  left: readonly ConversationRow[],
  right: readonly ConversationRow[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * 生成轮次级缓存键。resolver 只对含插件 UI 行的轮次参与比较；
 * 运行中轮次的工时/到期状态随 nowMs 变化，完成态轮次与 nowMs 无关。
 */
export function buildTurnRenderUnitCacheKey(input: {
  rows: readonly ConversationRow[];
  isLastTurn: boolean;
  isRunning: boolean;
  nowMs?: number;
  sessionPhase?: SessionPhase;
  pluginUiPinResolver?: BuildConversationTurnRenderUnitsOptions["pluginUiPinResolver"];
}): Pick<ConversationTurnRenderUnitsCacheEntry, "optionKey" | "resolver"> {
  const usesPluginUiPin = input.rows.some(
    (row) =>
      row.kind === "toolCall" &&
      row.display?.kind === "mcp_tool" &&
      row.display.ui !== undefined,
  );
  return {
    // 只依赖“是否最后一轮”而不是绝对下标：向上补页会让所有轮次下标 +N，
    // 但历史轮次的 materialize 结果不变，必须继续命中缓存，避免补页时全量重建。
    optionKey: [
      input.isLastTurn ? "last" : "history",
      input.isRunning ? "running" : "idle",
      input.isRunning ? Math.trunc(input.nowMs ?? 0) : "",
      input.sessionPhase ?? "",
    ].join("|"),
    resolver: usesPluginUiPin ? input.pluginUiPinResolver : undefined,
  };
}

/** 命中缓存时复用上一个 unit，否则 materialize 并写回。 */export function readCachedTurnRenderUnit(
  cache: ConversationTurnRenderUnitsCache | undefined,
  key: {
    turnId: string;
    header?: TurnHeaderRow;
    rows: readonly ConversationRow[];
    optionKey: string;
    resolver: ConversationTurnRenderUnitsCacheEntry["resolver"];
  },
  materialize: () => ConversationTurnRenderUnit,
): ConversationTurnRenderUnit {
  if (!cache) return materialize();
  const cached = cache.entries.get(key.turnId);
  if (
    cached &&
    cached.optionKey === key.optionKey &&
    cached.header === key.header &&
    cached.resolver === key.resolver &&
    sameRowReferences(cached.rows, key.rows)
  ) {
    return cached.unit;
  }
  const unit = materialize();
  cache.entries.set(key.turnId, {
    header: key.header,
    rows: key.rows,
    optionKey: key.optionKey,
    resolver: key.resolver,
    unit,
  });
  return unit;
}

/** rewind / 新分支裁掉的轮次不会回来，按本次构建结果清掉陈旧条目。 */
export function pruneTurnRenderUnitsCache(
  cache: ConversationTurnRenderUnitsCache | undefined,
  seenTurnIds: ReadonlySet<string>,
): void {
  if (!cache) return;
  for (const turnId of cache.entries.keys()) {
    if (!seenTurnIds.has(turnId)) cache.entries.delete(turnId);
  }
}
