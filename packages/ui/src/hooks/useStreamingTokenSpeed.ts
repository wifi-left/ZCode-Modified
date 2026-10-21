import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

/** 展示窗口：只反映最近 3 秒的生成速度，停顿后自动消失。 */
export const STREAMING_TOKEN_SPEED_WINDOW_MS = 3_000;
const STREAMING_TOKEN_SPEED_SAMPLE_INTERVAL_MS = 500;
/** 流式正文通常在最后几行；限制反向扫描,避免长 turn 每帧全量遍历。 */
const STREAMING_TOKEN_SPEED_SCAN_LIMIT = 80;
const STREAMING_TOKEN_SPEED_TAIL_CHARS = 256;

export interface StreamingTokenEstimate {
  turnId: string;
  tokens: number;
}

function countNonAscii(text: string): number {
  let count = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0x7f) count += 1;
  }
  return count;
}

/**
 * 协议没有逐 token 的用量事件，这里用流式正文字符数估算 output tokens：
 * ASCII 约 4 字符/token，CJK 等非 ASCII 约 1 字符/token。比例取自当前正文末尾样本，
 * 避免整段重新分词。只统计当前轮 assistantText/reasoning 的流式行。
 */
export function estimateStreamingTurnTokens(
  rows: readonly ConversationRow[] | null | undefined,
): StreamingTokenEstimate | null {
  if (!rows || rows.length === 0) return null;
  const turnId = rows[rows.length - 1]?.turnId;
  if (!turnId) return null;
  let chars = 0;
  let nonAscii = 0;
  let sampledChars = 0;
  const scanStart = Math.max(0, rows.length - STREAMING_TOKEN_SPEED_SCAN_LIMIT);
  for (let index = rows.length - 1; index >= scanStart; index -= 1) {
    const row = rows[index];
    if (!row || row.turnId !== turnId) break;
    if (
      (row.kind !== "assistantText" && row.kind !== "reasoning") ||
      row.state !== "streaming" ||
      row.text.length === 0
    ) {
      continue;
    }
    chars += row.text.length;
    if (sampledChars < STREAMING_TOKEN_SPEED_TAIL_CHARS && row.kind === "assistantText") {
      const tail = row.text.slice(-STREAMING_TOKEN_SPEED_TAIL_CHARS);
      sampledChars += tail.length;
      nonAscii += countNonAscii(tail);
    }
  }
  if (chars === 0) return null;
  const nonAsciiRatio = sampledChars > 0 ? nonAscii / sampledChars : 0;
  return {
    turnId,
    tokens: Math.max(1, Math.round(chars * (0.25 + 0.75 * nonAsciiRatio))),
  };
}

export function resolveStreamingTokenSpeed(
  samples: readonly { at: number; tokens: number }[],
): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  const durationMs = last.at - first.at;
  const deltaTokens = last.tokens - first.tokens;
  if (durationMs < STREAMING_TOKEN_SPEED_SAMPLE_INTERVAL_MS || deltaTokens <= 0) return null;
  return deltaTokens / (durationMs / 1000);
}

/**
 * 当前轮的实时生成速度（估算 tokens/s，最近 3 秒滑动窗口）。
 * 只在会话运行中返回数值；没有新增 token 时窗口耗尽后返回 null。
 */
export function useStreamingTokenSpeed(
  rows: readonly ConversationRow[] | null | undefined,
  active: boolean,
): number | null {
  const estimate = useMemo(() => estimateStreamingTurnTokens(rows), [rows]);
  const estimateRef = useRef(estimate);
  estimateRef.current = estimate;
  const [state, setState] = useState<{
    turnId: string | null;
    samples: Array<{ at: number; tokens: number }>;
  }>({ turnId: null, samples: [] });

  useEffect(() => {
    if (!active) {
      setState((current) =>
        current.turnId === null && current.samples.length === 0
          ? current
          : { turnId: null, samples: [] },
      );
      return;
    }
    const sample = () => {
      const now = Date.now();
      const current = estimateRef.current;
      setState((previous) => {
        if (!current) {
          return previous.samples.length === 0 ? previous : { ...previous, samples: [] };
        }
        const samples =
          previous.turnId === current.turnId ? previous.samples : [];
        const next = [
          ...samples.filter((entry) => now - entry.at <= STREAMING_TOKEN_SPEED_WINDOW_MS),
          { at: now, tokens: current.tokens },
        ];
        return { turnId: current.turnId, samples: next };
      });
    };
    sample();
    const timer = setInterval(sample, STREAMING_TOKEN_SPEED_SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return useMemo(
    () => (active ? resolveStreamingTokenSpeed(state.samples) : null),
    [active, state.samples],
  );
}
