import { describe, expect, it } from "vitest";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { areConversationTurnGroupPropsEqual } from "@/v4/ConversationTurnGroup.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

function assistantRow(rowId: number, text: string): ConversationRow {
  return {
    rowId,
    turnId: "turn-1",
    createdAt: 1,
    createdAtSeq: rowId,
    kind: "assistantText",
    text,
    state: "streaming",
  };
}

function unit(rows: readonly ConversationRow[], isRunning: boolean): ConversationTurnRenderUnit {
  return {
    key: "turn-1",
    turnId: "turn-1",
    header: undefined,
    orderedRows: rows,
    userInputs: [],
    visibleUserInputs: [],
    hookInvocations: [],
    assistantWorkRows: rows,
    assistantTextRows: rows,
    assistantHistoryRows: [],
    assistantFollowingRows: [],
    flowItems: [],
    workSegments: [],
    isRunning,
    isLastTurn: true,
    assistantHistoryDefaultOpen: false,
    timelineOnly: false,
    browserTurnEndRows: [],
  } as unknown as ConversationTurnRenderUnit;
}

const context = {} as ConversationRowRenderContext;

function props(targetUnit: ConversationTurnRenderUnit, nowMs: number) {
  return { unit: targetUnit, nowMs, context };
}

describe("ConversationTurnGroup memo comparator", () => {
  it("skips rendering when rows keep their identity (new arrays, same rows)", () => {
    const rows = [assistantRow(1, "hello")];
    const previous = unit([...rows], false);
    const next = unit([...rows], false);

    expect(areConversationTurnGroupPropsEqual(props(previous, 1000), props(next, 1000))).toBe(true);
  });

  it("ignores the wall clock for finished turns but not for the running turn", () => {
    const rows = [assistantRow(1, "hello")];
    expect(
      areConversationTurnGroupPropsEqual(
        props(unit([...rows], false), 1000),
        props(unit([...rows], false), 2000),
      ),
    ).toBe(true);
    expect(
      areConversationTurnGroupPropsEqual(
        props(unit([...rows], true), 1000),
        props(unit([...rows], true), 2000),
      ),
    ).toBe(false);
  });

  it("re-renders when a row changes", () => {
    const previousRows = [assistantRow(1, "hello")];
    const nextRows = [assistantRow(1, "hello world")];

    expect(
      areConversationTurnGroupPropsEqual(
        props(unit(previousRows, true), 1000),
        props(unit(nextRows, true), 1000),
      ),
    ).toBe(false);
  });

  it("re-renders when render context or callbacks change", () => {
    const rows = [assistantRow(1, "hello")];
    const previous = {
      ...props(unit(rows, false), 1000),
      onRetry: () => undefined,
    };
    const next = {
      ...props(unit(rows, false), 1000),
      onRetry: () => undefined,
    };

    expect(areConversationTurnGroupPropsEqual(previous, next)).toBe(false);
  });
});
