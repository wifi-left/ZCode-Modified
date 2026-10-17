import { describe, expect, it } from "vitest";

import {
  CODING_PLAN_TEAM_MOCK_BASE_URL_ENV,
  applyCodingPlanTeamMockEnv,
  clearCodingPlanTeamMockEnv,
  shouldPrepareCodingPlanTeamMock,
} from "./e2e/helpers/coding-plan-mock-env.js";

describe("Coding Plan E2E mock env", () => {
  it("定时任务创建遥测回归隔离账号控制面", () => {
    expect(shouldPrepareCodingPlanTeamMock([
      "./test/e2e/conversation-session/conversation-session-automation-run-title-stable.test.ts",
    ])).toBe(true);
  });
  it.each([
    "conversation-session-create-telemetry.test.ts",
    "conversation-session-offpeak-create.test.ts",
    "conversation-session-offpeak-create-existing-session.test.ts",
    "conversation-session-offpeak-subagent-model-inheritance.test.ts",
    "conversation-session-off-peak-invalid-ticket.test.ts",
  ])("prepares account facts as well as the off-peak gateway for %s", (spec) => {
    expect(shouldPrepareCodingPlanTeamMock([
      `./test/e2e/conversation-session/manual-review/pending/${spec}`,
    ])).toBe(true);
  });
  it("prepares account APIs for the formal real-app provider responsive case", () => {
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/provider-family-responsive.test.ts",
      ]),
    ).toBe(true);
  });
  it.each([
    "conversation-session-highspeed-card.test.ts",
    "conversation-session-highspeed-card-draw-timeout.test.ts",
    "conversation-session-highspeed-card-draw-miss.test.ts",
  ])("prepares Coding Plan entitlement for highspeed draw case %s", (spec) => {
    expect(shouldPrepareCodingPlanTeamMock([`./test/e2e/conversation-session/${spec}`])).toBe(true);
  });


  it("prepares the team mock when the default full-suite glob can select team specs", () => {
    expect(shouldPrepareCodingPlanTeamMock(["./test/e2e/**/*.test.ts"])).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/subagents/subagent-coding-plan-login-catalog-stale.test.ts",
      ]),
    ).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/conversation-session-model-provider-settings-transition.test.ts",
      ]),
    ).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/manual-review/pending/conversation-session-off-peak-team-plan.test.ts",
      ]),
    ).toBe(true);
    expect(
      shouldPrepareCodingPlanTeamMock([
        "./test/e2e/conversation-session/conversation-session-background.test.ts",
      ]),
    ).toBe(false);
  });
});
