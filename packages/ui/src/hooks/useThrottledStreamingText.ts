import { useEffect, useRef, useState } from "react";

/** 超过该长度的流式正文才降频；普通短回复保持逐帧更新，避免输入观感变钝。 */
export const STREAMING_TEXT_THROTTLE_THRESHOLD_CHARS = 4_000;
/** 长正文的 markdown 解析是有成本的同步工作，限制到 ~10fps 仍足够流畅。 */
export const STREAMING_TEXT_THROTTLE_INTERVAL_MS = 100;

/**
 * 长流式正文降频渲染。
 *
 * 每个 token delta 都会让 assistant 行拿到新 text；markdown/代码高亮按整段文本
 * 重新解析，文本越长单次成本越高，几百 KB 的输出会接近 O(n²) 的总工作量并卡住主线程。
 * 这里把“已提交给 markdown 渲染的文本”限制到固定频率：React 仍会收到每帧的行更新，
 * 但昂贵的子树只在节流窗口结束时重渲染。短文本和完成态直接返回原文，不做任何延迟。
 */
export function useThrottledStreamingText(
  text: string,
  streaming: boolean,
  options: {
    thresholdChars?: number;
    intervalMs?: number;
  } = {},
): string {
  const thresholdChars = options.thresholdChars ?? STREAMING_TEXT_THROTTLE_THRESHOLD_CHARS;
  const intervalMs = options.intervalMs ?? STREAMING_TEXT_THROTTLE_INTERVAL_MS;
  const enabled = streaming && text.length > thresholdChars;
  const [rendered, setRendered] = useState(text);
  const latestRef = useRef(text);
  const lastCommitAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = text;

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current !== null) return;
    const wait = Math.max(0, intervalMs - (Date.now() - lastCommitAtRef.current));
    if (wait === 0) {
      lastCommitAtRef.current = Date.now();
      setRendered(text);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastCommitAtRef.current = Date.now();
      setRendered(latestRef.current);
    }, wait);
  }, [enabled, intervalMs, text]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  // 完成瞬间必须立刻显示最终全文，不能等节流窗口。
  return enabled ? rendered : text;
}
