import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

type EnvRecord = Record<string, string | undefined>;

/** 与 CLI/数仓/ARMS 一致的全局遥测关闭开关。 */
const TELEMETRY_DISABLED = true;

/**
 * 本仓库已整体关闭遥测：渲染进程 action trace 与本地 TTFT 指标一并禁用上报；
 * 忽略 OTEL_EXPORTER_OTLP_* 环境变量（文件内保留端点解析以便将来恢复）。
 */
export function resolveRendererActionTraceEndpoint(env: EnvRecord): string | undefined {
  if (TELEMETRY_DISABLED) return undefined;
  const traceEndpoint = validHttpUrl(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (traceEndpoint) return traceEndpoint;
  const commonEndpoint = validHttpUrl(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!commonEndpoint) return undefined;
  const parsed = new URL(commonEndpoint);
  parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/v1/traces`;
  return parsed.toString();
}

export function parseRendererActionTraceHeaders(
  value: string | undefined,
): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const key = safeDecode(pair.slice(0, separator).trim());
    const headerValue = safeDecode(pair.slice(separator + 1).trim());
    if (key && headerValue) headers[key] = headerValue;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function createRendererActionTraceExporter(env: EnvRecord): SpanExporter | undefined {
  const endpoint = resolveRendererActionTraceEndpoint(env);
  if (!endpoint) return undefined;
  return new OTLPTraceExporter({
    url: endpoint,
    headers: parseRendererActionTraceHeaders(
      env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS,
    ),
    timeoutMillis: 3_000,
  });
}

export function validHttpUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  try {
    const parsed = new URL(normalized);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
