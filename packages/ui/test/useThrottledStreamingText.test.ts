// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledStreamingText } from "@/hooks/useThrottledStreamingText.js";

function useHarness(text: string, streaming: boolean) {
  return useThrottledStreamingText(text, streaming, {
    thresholdChars: 10,
    intervalMs: 100,
  });
}

describe("useThrottledStreamingText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders short streaming text without delay", () => {
    const { result, rerender } = renderHook(({ text, streaming }) => useHarness(text, streaming), {
      initialProps: { text: "short", streaming: true },
    });
    rerender({ text: "short a", streaming: true });
    expect(result.current).toBe("short a");
  });

  it("throttles long streaming text and flushes the final text immediately", () => {
    const initial = "x".repeat(20);
    const { result, rerender } = renderHook(({ text, streaming }) => useHarness(text, streaming), {
      initialProps: { text: initial, streaming: true },
    });
    const grown = `${initial}a`;
    rerender({ text: grown, streaming: true });
    // 未到节流窗口：markdown 子树的输入仍是上一帧文本。
    expect(result.current).toBe(initial);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(grown);

    const finished = `${grown}bc`;
    rerender({ text: finished, streaming: false });
    // 完成态不等窗口，立刻显示全文。
    expect(result.current).toBe(finished);
  });
});
