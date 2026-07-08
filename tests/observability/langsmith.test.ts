import { describe, expect, it } from "vitest";
import { createLangSmithRuntime, resolveLangSmithConfig } from "../../src/observability/langsmith";

describe("LangSmith observability config", () => {
  it("is disabled by default", () => {
    expect(resolveLangSmithConfig({}, {})).toEqual({ enabled: false });
  });

  it("enables tracing from CLI options", () => {
    expect(
      resolveLangSmithConfig(
        {
          langsmith: true,
          langsmithApiKey: "ls-cli",
          langsmithProject: "custom-project",
          langsmithEndpoint: "https://eu.api.smith.langchain.com",
          langsmithWorkspaceId: "workspace-id",
          langsmithHideInputs: true,
          langsmithHideOutputs: true,
        },
        {},
      ),
    ).toEqual({
      enabled: true,
      apiKey: "ls-cli",
      project: "custom-project",
      endpoint: "https://eu.api.smith.langchain.com",
      workspaceId: "workspace-id",
      hideInputs: true,
      hideOutputs: true,
    });
  });

  it("enables tracing from LangSmith environment variables", () => {
    expect(
      resolveLangSmithConfig(
        {},
        {
          LANGSMITH_TRACING: "true",
          LANGSMITH_API_KEY: "ls-env",
          LANGSMITH_PROJECT: "env-project",
          MARKSWEEP_LANGSMITH_HIDE_INPUTS: "yes",
          MARKSWEEP_LANGSMITH_HIDE_OUTPUTS: "1",
        },
      ),
    ).toEqual({
      enabled: true,
      apiKey: "ls-env",
      project: "env-project",
      hideInputs: true,
      hideOutputs: true,
    });
  });

  it("requires an API key when tracing is enabled", () => {
    expect(() => resolveLangSmithConfig({ langsmith: true }, {})).toThrow("缺少 LangSmith API Key");
  });

  it("rejects invalid boolean environment values", () => {
    expect(() =>
      resolveLangSmithConfig(
        {},
        {
          LANGSMITH_TRACING: "maybe",
        },
      ),
    ).toThrow("LANGSMITH_TRACING 必须是布尔值");
  });

  it("creates a LangChain callbacks runtime when enabled", () => {
    const config = resolveLangSmithConfig({ langsmith: true, langsmithApiKey: "ls-test" }, {});
    const runtime = createLangSmithRuntime(config, "classify");

    expect(runtime?.callbacks).toHaveLength(1);
    expect(runtime?.config.project).toBe("marksweep");
  });
});
