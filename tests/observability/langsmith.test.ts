import { describe, expect, it } from "vitest";
import { createLangSmithRuntime, resolveLangSmithConfig } from "../../src/observability/langsmith";

describe("LangSmith observability config", () => {
  it("is disabled by default", () => {
    expect(resolveLangSmithConfig({}, {})).toEqual({ enabled: false });
  });

  it("enables tracing from the required LangSmith environment variables", () => {
    expect(
      resolveLangSmithConfig(
        {},
        {
          LANGSMITH_API_KEY: "ls-env",
          LANGSMITH_PROJECT: "env-project",
        },
      ),
    ).toEqual({
      enabled: true,
      apiKey: "ls-env",
      project: "env-project",
      endpoint: "https://api.smith.langchain.com",
    });
  });

  it("uses the configured LangSmith endpoint when provided", () => {
    expect(
      resolveLangSmithConfig(
        {},
        {
          LANGSMITH_TRACING: "true",
          LANGSMITH_API_KEY: "ls-env",
          LANGSMITH_PROJECT: "env-project",
          LANGSMITH_ENDPOINT: "https://eu.api.smith.langchain.com",
        },
      ),
    ).toEqual({
      enabled: true,
      apiKey: "ls-env",
      project: "env-project",
      endpoint: "https://eu.api.smith.langchain.com",
    });
  });

  it("allows LANGSMITH_TRACING=false to disable env based tracing", () => {
    expect(
      resolveLangSmithConfig(
        {},
        {
          LANGSMITH_TRACING: "false",
          LANGSMITH_API_KEY: "ls-env",
          LANGSMITH_PROJECT: "env-project",
        },
      ),
    ).toEqual({ enabled: false });
  });

  it("requires an API key when tracing is enabled", () => {
    expect(() => resolveLangSmithConfig({ langsmith: true }, {})).toThrow("缺少 LangSmith API Key");
  });

  it("requires a project when tracing is enabled", () => {
    expect(() => resolveLangSmithConfig({ langsmith: true }, { LANGSMITH_API_KEY: "ls-test" })).toThrow(
      "缺少 LangSmith Project",
    );
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
    const config = resolveLangSmithConfig(
      { langsmith: true },
      { LANGSMITH_API_KEY: "ls-test", LANGSMITH_PROJECT: "default" },
    );
    const runtime = createLangSmithRuntime(config, "classify");

    expect(runtime?.callbacks).toHaveLength(1);
    expect(runtime?.config.project).toBe("default");
  });
});
