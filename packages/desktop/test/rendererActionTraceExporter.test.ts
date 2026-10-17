import { describe, expect, it } from "vitest";
import {
  parseRendererActionTraceHeaders,
  resolveRendererActionTraceEndpoint,
} from "../src/main/rendererActionTraceExporter.js";

describe("renderer action trace exporter config", () => {
  it("resolves no endpoint because telemetry is hard-disabled", () => {
    // 本仓库已关闭遥测：无论 OTEL env 怎么配，端点解析都必须返回 undefined（不发请求）。
    expect(
      resolveRendererActionTraceEndpoint({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example/custom",
      }),
    ).toBeUndefined();
    expect(
      resolveRendererActionTraceEndpoint({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://arms.example/otlp/",
      }),
    ).toBeUndefined();
  });

  it("rejects non-http endpoints and parses percent-encoded headers", () => {
    expect(
      resolveRendererActionTraceEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/x" }),
    ).toBeUndefined();
    expect(parseRendererActionTraceHeaders("x-key=hello%20world,ignored,x-two=2")).toEqual({
      "x-key": "hello world",
      "x-two": "2",
    });
  });
});
