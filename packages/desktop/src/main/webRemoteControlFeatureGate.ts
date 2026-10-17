export interface WebRemoteControlFeatureGate {
  isEnabled(): boolean;
  assertEnabled(): void;
}

// 本仓库已断开 Web 远程遥控（Z.ai 中继）：默认关闭。
// start/resetPairing/getStatus 都会走这里，gate 关闭后不会建立到中继的 WebSocket、
// 也不会注册设备配对材料；显式传 true 仅用于测试。
export function createWebRemoteControlFeatureGate(
  enabled = false,
): WebRemoteControlFeatureGate {
  return {
    isEnabled: () => enabled,
    assertEnabled: () => {
      if (!enabled) {
        throw new Error("Web remote control is disabled in this build");
      }
    },
  };
}
