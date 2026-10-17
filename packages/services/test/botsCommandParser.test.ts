import { describe, expect, it } from "vitest";
import { parseBotCommand } from "../src/bots/commandParser.js";

describe("bots command parser", () => {
  it("parses known commands", () => {
    expect(parseBotCommand("/leave")).toEqual({ type: "topic.leave" });
    expect(parseBotCommand("/help")).toEqual({ type: "help" });
    expect(parseBotCommand("/cancel")).toEqual({ type: "selection.cancel" });
    expect(parseBotCommand("/取消")).toEqual({ type: "selection.cancel" });
    expect(parseBotCommand("/status")).toEqual({ type: "status" });
    expect(parseBotCommand("/new")).toEqual({ type: "new" });
    expect(parseBotCommand("/clear")).toEqual({ type: "new" });
    expect(parseBotCommand("/reconnect")).toEqual({ type: "reconnect" });
    expect(parseBotCommand("/重连")).toEqual({ type: "reconnect" });
    expect(parseBotCommand("/workspace")).toEqual({ type: "workspace.list" });
    expect(parseBotCommand("/workspace 1")).toEqual({ type: "workspace.set", value: "1" });
    expect(parseBotCommand("/project")).toEqual({ type: "workspace.list" });
    expect(parseBotCommand("/项目 1")).toEqual({ type: "workspace.set", value: "1" });
    expect(parseBotCommand("/model gpt-5.4")).toEqual({ type: "model.set", value: "gpt-5.4" });
    expect(parseBotCommand("/model provider 1")).toEqual({
      type: "model.provider.set",
      value: "1",
    });
    expect(parseBotCommand("/model model 1")).toEqual({ type: "model.set", value: "1" });
    expect(parseBotCommand("/模型 gpt-5.4")).toEqual({ type: "model.set", value: "gpt-5.4" });
    expect(parseBotCommand("/thoughtLevel medium")).toEqual({
      type: "thoughtLevel.set",
      value: "medium",
    });
    expect(parseBotCommand("/think medium")).toEqual({ type: "thoughtLevel.set", value: "medium" });
    expect(parseBotCommand("/思考 medium")).toEqual({ type: "thoughtLevel.set", value: "medium" });
    expect(parseBotCommand("/mode auto")).toEqual({ type: "mode.set", value: "auto" });
    expect(parseBotCommand("/模式 auto")).toEqual({ type: "mode.set", value: "auto" });
    expect(parseBotCommand("/回复 full")).toEqual({ type: "reply.set", value: "full" });
    expect(parseBotCommand("/停止")).toEqual({ type: "stop" });
    expect(parseBotCommand("/permission 1")).toEqual({ type: "permission.respond", value: "1" });
    expect(parseBotCommand("/elicitation 2")).toEqual({ type: "elicitation.respond", value: "2" });
    expect(parseBotCommand("/answer custom value")).toEqual({
      type: "elicitation.respond",
      value: "custom value",
    });
    expect(parseBotCommand("/回答 完成")).toEqual({ type: "elicitation.submit" });
    expect(parseBotCommand("/bind ABC123")).toEqual({ type: "bind", code: "ABC123" });
  });

  it("parses Chinese aliases for top-level commands", () => {
    expect(parseBotCommand("/帮助")).toEqual({ type: "help" });
    expect(parseBotCommand("/状态")).toEqual({ type: "status" });
    expect(parseBotCommand("/新建")).toEqual({ type: "new" });
  });

  it("parses approval commands", () => {
    expect(parseBotCommand("/approve req allow")).toEqual({
      type: "approve",
      requestId: "req",
      optionId: "allow",
    });
    expect(parseBotCommand("/deny req")).toEqual({ type: "deny", requestId: "req" });
  });

  it("parses queue, usage, diff, history and result commands", () => {
    expect(parseBotCommand("/queue")).toEqual({ type: "queue.list" });
    expect(parseBotCommand("/队列")).toEqual({ type: "queue.list" });
    expect(parseBotCommand("/队列 列表")).toEqual({ type: "queue.list" });
    expect(parseBotCommand("/queue 2")).toEqual({
      type: "queue.cancel",
      commandId: "2",
      value: "2",
    });
    expect(parseBotCommand("/queue delete 3")).toEqual({
      type: "queue.cancel",
      commandId: "3",
      value: "3",
    });
    expect(parseBotCommand("/队列 删除 1")).toEqual({
      type: "queue.cancel",
      commandId: "1",
      value: "1",
    });
    expect(parseBotCommand("/queue-cancel cmd-9")).toEqual({
      type: "queue.cancel",
      commandId: "cmd-9",
      value: "cmd-9",
    });
    expect(parseBotCommand("/usage")).toEqual({ type: "usage" });
    expect(parseBotCommand("/用量")).toEqual({ type: "usage" });
    expect(parseBotCommand("/diff")).toEqual({ type: "diff" });
    expect(parseBotCommand("/改动")).toEqual({ type: "diff" });
    // /history 在群里仍是历史开关，数字参数走私聊的最近消息回放。
    expect(parseBotCommand("/history")).toEqual({ type: "group.history" });
    expect(parseBotCommand("/history on")).toEqual({ type: "group.history", enabled: true });
    expect(parseBotCommand("/history 20")).toEqual({ type: "history.list", value: "20" });
    expect(parseBotCommand("/历史 5")).toEqual({ type: "history.list", value: "5" });
    expect(parseBotCommand("/result")).toEqual({ type: "result" });
    expect(parseBotCommand("/result 2")).toEqual({ type: "result", value: "2" });
    expect(parseBotCommand("/结果 2")).toEqual({ type: "result", value: "2" });
  });

  it("treats normal text as a message and incomplete commands as unknown", () => {
    expect(parseBotCommand("hello")).toEqual({ type: "message", text: "hello" });
    expect(parseBotCommand("0")).toEqual({ type: "selection.cancel" });
    expect(parseBotCommand("/bind")).toEqual({ type: "unknown", name: "bind", raw: "/bind" });
    expect(parseBotCommand("/wat")).toEqual({ type: "unknown", name: "wat", raw: "/wat" });
    expect(parseBotCommand("/approval on-request")).toEqual({
      type: "unknown",
      name: "approval",
      raw: "/approval on-request",
    });
    expect(parseBotCommand("/cli")).toEqual({
      type: "unknown",
      name: "cli",
      raw: "/cli",
    });
    expect(parseBotCommand("/sandbox workspace-write")).toEqual({
      type: "unknown",
      name: "sandbox",
      raw: "/sandbox workspace-write",
    });
  });
});
