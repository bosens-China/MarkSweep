import type { Callbacks } from "@langchain/core/callbacks/manager";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { Client } from "langsmith";

export interface RawLangSmithOptions {
  langsmith?: boolean;
  langsmithApiKey?: string;
  langsmithProject?: string;
  langsmithEndpoint?: string;
  langsmithWorkspaceId?: string;
  langsmithHideInputs?: boolean;
  langsmithHideOutputs?: boolean;
}

export type LangSmithConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      apiKey: string;
      project: string;
      endpoint?: string;
      workspaceId?: string;
      hideInputs: boolean;
      hideOutputs: boolean;
    };

export interface LangSmithRuntime {
  callbacks: Callbacks;
  client: Client;
  config: Extract<LangSmithConfig, { enabled: true }>;
}

export function resolveLangSmithConfig(
  rawOptions: RawLangSmithOptions,
  env: NodeJS.ProcessEnv = process.env,
): LangSmithConfig {
  const explicitCliConfig = [
    rawOptions.langsmith,
    rawOptions.langsmithApiKey,
    rawOptions.langsmithProject,
    rawOptions.langsmithEndpoint,
    rawOptions.langsmithWorkspaceId,
    rawOptions.langsmithHideInputs,
    rawOptions.langsmithHideOutputs,
  ].some((value) => value !== undefined);
  const envTracing = firstDefined(
    parseBooleanEnv("MARKSWEEP_LANGSMITH_TRACING", env.MARKSWEEP_LANGSMITH_TRACING),
    parseBooleanEnv("LANGSMITH_TRACING", env.LANGSMITH_TRACING),
  );
  const enabled = rawOptions.langsmith ?? (explicitCliConfig ? true : envTracing) ?? false;

  if (!enabled) {
    return { enabled: false };
  }

  const apiKey = firstNonEmpty(rawOptions.langsmithApiKey, env.MARKSWEEP_LANGSMITH_API_KEY, env.LANGSMITH_API_KEY);
  if (!apiKey) {
    throw new Error(
      "缺少 LangSmith API Key：请通过 --langsmith-api-key、MARKSWEEP_LANGSMITH_API_KEY 或 LANGSMITH_API_KEY 提供。",
    );
  }

  return {
    enabled: true,
    apiKey,
    project:
      firstNonEmpty(rawOptions.langsmithProject, env.MARKSWEEP_LANGSMITH_PROJECT, env.LANGSMITH_PROJECT) ?? "marksweep",
    endpoint: firstNonEmpty(rawOptions.langsmithEndpoint, env.MARKSWEEP_LANGSMITH_ENDPOINT, env.LANGSMITH_ENDPOINT),
    workspaceId: firstNonEmpty(
      rawOptions.langsmithWorkspaceId,
      env.MARKSWEEP_LANGSMITH_WORKSPACE_ID,
      env.LANGSMITH_WORKSPACE_ID,
    ),
    hideInputs:
      rawOptions.langsmithHideInputs ??
      parseBooleanEnv("MARKSWEEP_LANGSMITH_HIDE_INPUTS", env.MARKSWEEP_LANGSMITH_HIDE_INPUTS) ??
      false,
    hideOutputs:
      rawOptions.langsmithHideOutputs ??
      parseBooleanEnv("MARKSWEEP_LANGSMITH_HIDE_OUTPUTS", env.MARKSWEEP_LANGSMITH_HIDE_OUTPUTS) ??
      false,
  };
}

export function createLangSmithRuntime(config: LangSmithConfig, command: string): LangSmithRuntime | undefined {
  if (!config.enabled) {
    return undefined;
  }

  const client = new Client({
    apiKey: config.apiKey,
    apiUrl: config.endpoint,
    workspaceId: config.workspaceId,
    hideInputs: config.hideInputs,
    hideOutputs: config.hideOutputs,
    blockOnRootRunFinalization: true,
  });
  const tracer = new LangChainTracer({
    client,
    projectName: config.project,
    tags: ["marksweep", command],
    metadata: {
      app: "marksweep",
      command,
    },
  });

  return {
    callbacks: [tracer],
    client,
    config,
  };
}

export async function flushLangSmithRuntime(runtime: LangSmithRuntime | undefined): Promise<unknown | undefined> {
  if (!runtime) {
    return undefined;
  }

  try {
    await runtime.client.awaitPendingTraceBatches();
    return undefined;
  } catch (error) {
    return error;
  }
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parseBooleanEnv(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} 必须是布尔值：true/false、1/0、yes/no 或 on/off。`);
}
