import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTelemetryCore } from "../src/telemetry/telemetryCore.js";
import { createTelemetryAuthorizationLoader } from "../src/node.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
// 遥测已硬关闭：上报不再发出请求，原先断言 request headers/retry/logout 的用例不再适用。
// 这里保留真正有约束力的部分：JWT 授权加载器只读 zcodejwttoken、账号切换与失败即关闭。

it.each(["zai", "bigmodel"])(
  "only reads JWT for active %s, never OAuth/API keys",
  async (provider) => {
    const values: Record<string, string> = {
      "oauth:active_provider": provider,
      [`oauth:${provider}:user_info`]: '{"id":"u1"}',
      zcodejwttoken: "jwt-1",
    };
    const load = vi.fn(async (key: string) => values[key] ?? null);
    const authorization = createTelemetryAuthorizationLoader({ load });
    expect(await authorization("u1")).toBe("Bearer jwt-1");
    values.zcodejwttoken = "jwt-2";
    expect(await authorization("u1")).toBe("Bearer jwt-2");
    expect(await authorization("other-user")).toBeNull();
    delete values["oauth:active_provider"];
    expect(await authorization("u1")).toBeNull();
    expect(await authorization("")).toBeNull();
    expect(
      load.mock.calls.every(([key]) => !key.includes("access_token") && !key.includes("api_key")),
    ).toBe(true);
  },
);

it("drops JWT when the account changes during the read, and fails closed on errors", async () => {
  let provider = "bigmodel";
  const authorization = createTelemetryAuthorizationLoader({
    load: async (key) => {
      if (key === "oauth:active_provider") return provider;
      if (key.endsWith(":user_info")) return '{"user_id":"u1"}';
      provider = "zai";
      return "old-jwt";
    },
  });
  expect(await authorization("u1")).toBeNull();
  const failed = createTelemetryAuthorizationLoader({
    load: async () => {
      throw new Error("secret");
    },
  });
  expect(await failed("u1")).toBeNull();
});

it.each([null, "", "   ", "bad\r\nheader"])("omits absent or unsafe JWT: %j", async (token) => {
  const authorization = createTelemetryAuthorizationLoader({
    load: async (key) => {
      if (key === "oauth:active_provider") return "zai";
      if (key.endsWith(":user_info")) return '{"id":"u1"}';
      return token;
    },
  });
  expect(await authorization("u1")).toBeNull();
});
