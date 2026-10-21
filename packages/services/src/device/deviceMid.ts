import { createUuid } from "@zcode/shared";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "../paths.js";

// 设备身份（device_mid）由本模块维护：provider 请求头 X-Device-Mid、反馈、计费与
// relay 请求都依赖它。持久化文件名沿用 telemetry-state.json、字段名沿用 deviceMid，
// 这样 Desktop、远端 server 与 CLI 已有的设备身份不会因为删除遥测而丢失。
const LOCK_RETRY_DELAY_MS = 10;
const LOCK_RETRY_COUNT = 200;
const LOCK_STALE_MS = 5 * 60 * 1000;

interface DeviceState {
  deviceMid?: string;
  [key: string]: unknown;
}

interface DeviceStateLockOwner {
  pid: number;
  createdAt: number;
}

const deviceMidCacheByStateFile = new Map<string, Promise<string>>();

function resolveDeviceStateFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.json");
  }
  return join(getAppConfigDir(), "telemetry-state.json");
}

function resolveDeviceStateLockFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".zcode", "v2", "telemetry-state.lock");
  }
  return join(getAppConfigDir(), "telemetry-state.lock");
}

async function readDeviceState(homeDir?: string): Promise<DeviceState> {
  try {
    const raw = await readFile(resolveDeviceStateFile(homeDir), "utf-8");
    const parsed = JSON.parse(raw) as DeviceState;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDeviceState(state: DeviceState, homeDir?: string): Promise<void> {
  const stateFile = resolveDeviceStateFile(homeDir);
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf-8");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleDeviceLockIfNeeded(
  lockFile: string,
  timestamp: number,
): Promise<boolean> {
  try {
    const metadata = await stat(lockFile);
    if (timestamp - metadata.mtimeMs < LOCK_STALE_MS) {
      const owner = await readDeviceLockOwner(lockFile);
      if (!owner || isProcessAlive(owner.pid)) {
        return false;
      }
    }

    await unlink(lockFile).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readDeviceLockOwner(lockFile: string): Promise<DeviceStateLockOwner | null> {
  try {
    const raw = await readFile(lockFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DeviceStateLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ESRCH"
    );
  }
}

async function withDeviceStateLock<T>(
  homeDir: string | undefined,
  run: (state: DeviceState) => Promise<T>,
): Promise<T> {
  const lockFile = resolveDeviceStateLockFile(homeDir);
  await mkdir(dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        // 旧锁文件只有一个空文件，崩溃后 5 分钟内无法判断是否为孤儿锁。
        // 新锁写入 owner pid，让后续进程能安全回收“刚残留但持有进程已退出”的锁。
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
          }),
          "utf-8",
        );
        const state = await readDeviceState(homeDir);
        return await run(state);
      } finally {
        await handle.close();
        await unlink(lockFile).catch(() => {});
      }
    } catch (error) {
      const isLockConflict =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!isLockConflict) {
        throw error;
      }

      // 崩溃/强退后锁文件可能遗留在磁盘上，按 mtime 识别明显过期的孤儿锁并自动回收。
      const removedStaleLock = await removeStaleDeviceLockIfNeeded(lockFile, Date.now());
      if (removedStaleLock) {
        continue;
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error("Device state lock timeout");
}

export interface EnsureDeviceMidOptions {
  homeDir?: string;
  randomUUID?: () => string;
}

function rememberDeviceMid(deviceStateFile: string, deviceMid: string): string {
  deviceMidCacheByStateFile.set(deviceStateFile, Promise.resolve(deviceMid));
  return deviceMid;
}

/** 调用方必须已持有 device state 锁；只在 state 缺失 deviceMid 时生成并写回。 */
async function ensureDeviceMidInLockedState(
  state: DeviceState,
  options: EnsureDeviceMidOptions,
): Promise<string> {
  const deviceStateFile = resolveDeviceStateFile(options.homeDir);
  if (state.deviceMid) {
    return rememberDeviceMid(deviceStateFile, state.deviceMid);
  }

  const deviceMid = (options.randomUUID ?? createUuid)();
  state.deviceMid = deviceMid;
  await writeDeviceState(state, options.homeDir);
  return rememberDeviceMid(deviceStateFile, deviceMid);
}

/**
 * 确保 telemetry-state.json 里存在 deviceMid 并返回它。
 *
 * 远端 zcode-server 所在主机没有 Desktop main 进程，过去没有任何进程会在那里写
 * telemetry-state.json；buildZCodeSourceHeaders() 又只读不生成，于是远端发往 ZCode endpoint
 * 的请求永远缺 X-Device-Mid，billing/balance 被服务端拒绝为 parameter error，Start Plan 在远程
 * 工作区被判成未开通。这里把设备身份确保逻辑抽成独立入口，供远端 server 启动时调用：
 * 同一个文件、同一个字段、同一把锁，与同机 CLI 得到同一个设备身份。
 */
export function ensureDeviceMid(options: EnsureDeviceMidOptions = {}): Promise<string> {
  const deviceStateFile = resolveDeviceStateFile(options.homeDir);
  const cached = deviceMidCacheByStateFile.get(deviceStateFile);
  if (cached) {
    return cached;
  }

  // deviceMid 已落盘时也按 state 文件缓存读取 promise，避免高频调用反复抢文件锁。
  const pending = withDeviceStateLock(options.homeDir, async (state) =>
    ensureDeviceMidInLockedState(state, options),
  ).catch((error) => {
    if (deviceMidCacheByStateFile.get(deviceStateFile) === pending) {
      deviceMidCacheByStateFile.delete(deviceStateFile);
    }
    throw error;
  });
  deviceMidCacheByStateFile.set(deviceStateFile, pending);
  return pending;
}
