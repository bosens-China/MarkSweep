import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface StoredAiConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  lang?: string;
}

export interface StoredLangSmithConfig {
  enabled?: boolean;
  apiKey?: string;
  project?: string;
  endpoint?: string;
  workspaceId?: string;
  hideInputs?: boolean;
  hideOutputs?: boolean;
}

export interface MarkSweepUserConfig {
  version: 1;
  ai?: StoredAiConfig;
  langSmith?: StoredLangSmithConfig;
}

export function createEmptyUserConfig(): MarkSweepUserConfig {
  return {
    version: 1,
  };
}

export function getDefaultUserConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.MARKSWEEP_CONFIG_PATH?.trim()) {
    return path.resolve(env.MARKSWEEP_CONFIG_PATH.trim());
  }

  if (platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "marksweep", "config.json");
  }

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "marksweep", "config.json");
  }

  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "marksweep", "config.json");
}

export async function loadUserConfig(configPath = getDefaultUserConfigPath()): Promise<MarkSweepUserConfig> {
  const raw = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (!raw) {
    return createEmptyUserConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`本地配置文件无法解析：${configPath}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`本地配置文件格式不正确：${configPath}`);
  }

  return normalizeUserConfig(parsed);
}

export async function saveUserConfig(
  config: MarkSweepUserConfig,
  configPath = getDefaultUserConfigPath(),
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configPath, 0o600).catch(() => undefined);
}

export function mergeAiConfig(
  userConfig: MarkSweepUserConfig,
  aiConfig: Required<StoredAiConfig>,
): MarkSweepUserConfig {
  return {
    ...userConfig,
    version: 1,
    ai: {
      ...userConfig.ai,
      ...aiConfig,
    },
  };
}

function normalizeUserConfig(value: Record<string, unknown>): MarkSweepUserConfig {
  const config = createEmptyUserConfig();

  if (isPlainObject(value.ai)) {
    config.ai = pickStringFields(value.ai, ["baseUrl", "model", "apiKey", "lang"]);
  }

  if (isPlainObject(value.langSmith)) {
    config.langSmith = {
      ...pickStringFields(value.langSmith, ["apiKey", "project", "endpoint", "workspaceId"]),
      ...pickBooleanFields(value.langSmith, ["enabled", "hideInputs", "hideOutputs"]),
    };
  }

  return config;
}

function pickStringFields(value: Record<string, unknown>, keys: string[]): Record<string, string> {
  const output: Record<string, string> = {};

  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim().length > 0) {
      output[key] = item.trim();
    }
  }

  return output;
}

function pickBooleanFields(value: Record<string, unknown>, keys: string[]): Record<string, boolean> {
  const output: Record<string, boolean> = {};

  for (const key of keys) {
    const item = value[key];
    if (typeof item === "boolean") {
      output[key] = item;
    }
  }

  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
