// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import {
  estimateStreamingTurnTokens,
  resolveStreamingTokenSpeed,
  useStreamingTokenSpeed,
} from "@/hooks/useStreamingTokenSpeed.js";

function streamingRows(text: string, turnId = "turn-1"): ConversationRow[] {
  return [
    {
      rowId: 1,
      turnId,
      kind: "assistantText",
      state: "streaming",
      text,
    } as unknown as ConversationRow,
  ];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("estimateStreamingTurnTokens", () => {
  it("estimates ASCII at ~4 chars/token and CJK at ~1 char/token", () => {
    expect(estimateStreamingTurnTokens(streamingRows("a".repeat(400)))?.tokens).toBe(100);
    expect(estimateStreamingTurnTokens(streamingRows("中".repeat(100)))?.tokens).toBe(100);
  });

  it("ignores completed rows and returns null when nothing is streaming", () => {
    const completed = streamingRows("done") as Array<Record<string, unknown>>;
    completed[0]!.state = "complete";
    expect(estimateStreamingTurnTokens(completed as unknown as ConversationRow[])).toBeNull();
  });
});

describe("resolveStreamingTokenSpeed", () => {
  it("returns the sliding-window average only when tokens grew", () => {
    expect(
      resolveStreamingTokenSpeed([
        { at: 0, tokens: 100 },
        { at: 2_000, tokens: 1_100 },
      ]),
    ).toBe(500);
    expect(
      resolveStreamingTokenSpeed([
        { at: 0, tokens: 100 },
        { at: 2_000, tokens: 100 },
      ]),
    ).toBeNull();
    expect(resolveStreamingTokenSpeed([{ at: 0, tokens: 100 }])).toBeNull();
  });
});

describe("useStreamingTokenSpeed", () => {
  it("reports speed from streaming text growth and clears when generation stops", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ text, active }) => useStreamingTokenSpeed(streamingRows(text), active),
      { initialProps: { text: "a".repeat(40), active: true } },
    );
    expect(result.current).toBeNull();

    rerender({ text: "a".repeat(400), active: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // (100 - 10) tokens / 0.5s
    expect(result.current).toBeCloseTo(180, 0);

    rerender({ text: "a".repeat(400), active: false });
    expect(result.current).toBeNull();
  });
});
