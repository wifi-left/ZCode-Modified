import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalTtftExporter } from "../src/main/localTtftExporter.js";
import {
  createRendererActionTraceExporter,
  resolveRendererActionTraceEndpoint,
} from "../src/main/rendererActionTraceExporter.js";

const servers: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

/** 本仓库在源码层关闭了遥测：桌面端 OTLP 导出器解析端点必须失败，且不得发出任何请求。 */
describe("desktop telemetry hard off", () => {
  it("resolves no renderer action trace endpoint even when OTEL env is set", () => {
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
    expect(createRendererActionTraceExporter({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://x.test" })).toBeUndefined();
  });

  it("local TTFT exporter never posts to the configured endpoint", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.statusCode = 204;
      response.end();
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", () => ready()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const endpoint = `http://127.0.0.1:${address.port}`;

    const exporter = createLocalTtftExporter({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint },
      version: "test",
      logger: { warn() {} },
    });
    exporter.enqueue({
      version: 1,
      observationId: "e0b15fc2-3a50-4d73-854d-61fa148cbfd0",
      kind: "checkpoint",
      outcome: "closed",
      start: 1000,
      end: 1200,
      quality: "complete",
      sendMode: "queued",
      visibility: "foreground",
      timingReliable: true,
      intervals: [],
      details: [],
      ttftMs: 200,
    });
    await exporter.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(requests).toBe(0);
  });
});
