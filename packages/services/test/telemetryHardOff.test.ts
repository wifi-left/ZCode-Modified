import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryCore, ensureTelemetryDeviceMid } from "../src/telemetry/telemetryCore.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 本仓库在源码层关闭了遥测（REPORT_ENDPOINT 固定为空）。
 * 这里锁定硬关闭契约：任何上报入口都不得产生网络请求，而设备身份 device_mid
 * 必须继续被持久化（provider 请求头 X-Device-Mid、反馈与计费仍依赖它）。
 */
describe("telemetry hard off", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "zcode-telemetry-off-"));
    dirs.push(dir);
    return dir;
  }

  it("emits no HTTP request for app launch, events or daily active", async () => {
    const homeDir = makeHome();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const core = createTelemetryCore({
      homeDir,
      fetchImpl,
      resolveZCodeEndpointOrigin: () => "https://zcode.z.ai",
    });

    await core.reportAppLaunch({
      clientLanguage: "zh-CN",
      clientTimezone: "Asia/Shanghai",
      screenResolution: "1x1",
    });
    await core.reportEvent({
      context: { clientLanguage: "zh-CN", clientTimezone: "Asia/Shanghai", screenResolution: "1x1" },
      elementName: "unit_test_event",
      eventRegion: "test",
      eventType: "test",
      eventExtraDetail: {},
    });
    await core.reportAppDailyActive({
      clientLanguage: "zh-CN",
      clientTimezone: "Asia/Shanghai",
      screenResolution: "1x1",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still persists a stable device mid in telemetry-state.json", async () => {
    const homeDir = makeHome();
    const first = await ensureTelemetryDeviceMid({ homeDir });
    const second = await ensureTelemetryDeviceMid({ homeDir });

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
    expect(
      JSON.parse(readFileSync(join(homeDir, ".zcode", "v2", "telemetry-state.json"), "utf-8"))
        .deviceMid,
    ).toBe(first);
  });
});
