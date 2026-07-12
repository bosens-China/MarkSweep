import type { Callbacks } from "@langchain/core/callbacks/manager";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { Client } from "langsmith";

export interface RawLangSmithOptions {
  langsmith?: boolean;
}

const defaultLangSmithEndpoint = "https://api.smith.langchain.com";

export type LangSmithConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      apiKey: string;
      project: string;
      endpoint: string;
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
  const apiKey = firstNonEmpty(env.LANGSMITH_API_KEY);
  const project = firstNonEmpty(env.LANGSMITH_PROJECT);
  const envTracing = parseBooleanEnv("LANGSMITH_TRACING", env.LANGSMITH_TRACING);
  const enabled = rawOptions.langsmith ?? envTracing ?? Boolean(apiKey && project);

  if (!enabled) {
    return { enabled: false };
  }

  if (!apiKey) {
    throw new Error("缺少 LangSmith API Key：请通过 LANGSMITH_API_KEY 提供。");
  }

  if (!project) {
    throw new Error("缺少 LangSmith Project：请通过 LANGSMITH_PROJECT 提供。");
  }

  return {
    enabled: true,
    apiKey,
    project,
    endpoint: firstNonEmpty(env.LANGSMITH_ENDPOINT) ?? defaultLangSmithEndpoint,
  };
}

export function createLangSmithRuntime(config: LangSmithConfig, command: string): LangSmithRuntime | undefined {
  if (!config.enabled) {
    return undefined;
  }

  const client = new Client({
    apiKey: config.apiKey,
    apiUrl: config.endpoint,
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

export async function getLangSmithProjectUrl(runtime: LangSmithRuntime | undefined): Promise<string | undefined> {
  if (!runtime) {
    return undefined;
  }

  try {
    return await runtime.client.getProjectUrl({ projectName: runtime.config.project });
  } catch {
    return runtime.config.endpoint === defaultLangSmithEndpoint ? "https://smith.langchain.com" : undefined;
  }
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
