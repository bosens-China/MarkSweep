import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { confirm, password, input as promptInput } from "@inquirer/prompts";
import { InvalidArgumentError } from "commander";
import {
  createEmptyUserConfig,
  getDefaultUserConfigPath,
  loadUserConfig,
  mergeAiConfig,
  saveUserConfig,
  type MarkSweepUserConfig,
} from "./user-config.js";

const htmlExtensions = new Set([".html", ".htm"]);

export interface BookmarkInputFile {
  absolutePath: string;
  html: string;
}

export interface DetectionOptions {
  concurrency: number;
  timeout: number;
  retries: number;
}

export interface RawAiOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  lang?: string;
}

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  lang: string;
}

export interface WebPageFetcherConfig {
  firecrawlApiKey?: string;
  firecrawlBaseUrl?: string;
  jinaApiKey?: string;
}

export interface ResolveAiConfigContext {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  configPath?: string;
  userConfig?: MarkSweepUserConfig;
  prompts?: AiConfigPrompts;
  offerToSave?: boolean;
}

export interface AiConfigPrompts {
  input: typeof promptInput;
  password: typeof password;
  confirm: typeof confirm;
}

export function parsePositiveInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("必须是大于 0 的整数");
  }

  return parsed;
}

export function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("必须是大于等于 0 的整数");
  }

  return parsed;
}

export async function readBookmarkHtmlFile(inputPath: string): Promise<BookmarkInputFile> {
  const absolutePath = path.resolve(inputPath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!htmlExtensions.has(extension)) {
    throw new Error("仅支持浏览器导出的 .html 或 .htm 书签文件");
  }

  const fileStat = await stat(absolutePath).catch(() => {
    throw new Error(`输入文件不存在：${absolutePath}`);
  });

  if (!fileStat.isFile()) {
    throw new Error(`输入路径不是文件：${absolutePath}`);
  }

  const html = await readFile(absolutePath, "utf8");
  return { absolutePath, html };
}

export function resolveDefaultOutputPath(inputPath: string, suffix: "cleaned" | "classified"): string {
  const parsed = path.parse(path.resolve(inputPath));
  return path.join(parsed.dir, `${parsed.name}.${suffix}.html`);
}

export function resolveOutputPath(
  inputPath: string,
  explicitOutput: string | undefined,
  suffix: "cleaned" | "classified",
): string {
  return explicitOutput ? path.resolve(explicitOutput) : resolveDefaultOutputPath(inputPath, suffix);
}

export async function assertWritableOutputPath(inputPath: string, outputPath: string): Promise<void> {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (isSameFilePath(resolvedInput, resolvedOutput)) {
    throw new Error("输出文件不能覆盖原始书签文件");
  }

  const outputDirectory = path.dirname(resolvedOutput);
  await access(outputDirectory).catch(() => {
    throw new Error(`输出目录不存在：${outputDirectory}`);
  });
}

export async function resolveAiConfig(
  rawOptions: RawAiOptions,
  context: ResolveAiConfigContext = {},
): Promise<AiConfig> {
  const env = context.env ?? process.env;
  const interactive = context.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompts = context.prompts ?? { input: promptInput, password, confirm };
  const configPath = context.configPath ?? getDefaultUserConfigPath(env);
  const rawBaseUrl = firstNonEmpty(rawOptions.baseUrl, env.MARKSWEEP_AI_BASE_URL, env.OPENAI_BASE_URL);
  const rawModel = firstNonEmpty(rawOptions.model, env.MARKSWEEP_AI_MODEL, env.OPENAI_MODEL);
  const rawApiKey = firstNonEmpty(rawOptions.apiKey, env.MARKSWEEP_AI_API_KEY, env.OPENAI_API_KEY);
  const rawLang = firstNonEmpty(rawOptions.lang, env.MARKSWEEP_LANG);
  const needsUserConfig = !rawBaseUrl || !rawModel || !rawApiKey;
  const userConfig =
    context.userConfig ?? (needsUserConfig ? await loadUserConfig(configPath) : createEmptyUserConfig());
  let promptedForConfig = false;

  const baseUrl =
    firstNonEmpty(rawBaseUrl, userConfig.ai?.baseUrl) ??
    (interactive
      ? await promptForValue(() =>
          prompts.input({
            message: "AI Base URL",
            default: "https://api.openai.com/v1",
          }),
        )
      : undefined);

  const model =
    firstNonEmpty(rawModel, userConfig.ai?.model) ??
    (interactive
      ? await promptForValue(() =>
          prompts.input({
            message: "AI 模型",
            default: "gpt-4.1-mini",
          }),
        )
      : undefined);

  const apiKey =
    firstNonEmpty(rawApiKey, userConfig.ai?.apiKey) ??
    (interactive
      ? await promptForValue(() =>
          prompts.password({
            message: "AI API Key",
            mask: "*",
          }),
        )
      : undefined);

  const lang = firstNonEmpty(rawLang, userConfig.ai?.lang) ?? "zh";

  async function promptForValue(callback: () => Promise<string>): Promise<string> {
    promptedForConfig = true;
    return callback();
  }

  const missing = [
    ["base-url", baseUrl],
    ["model", model],
    ["api-key", apiKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`缺少 AI 参数：${missing.join(", ")}。请通过 CLI 参数、环境变量、本地配置或交互式输入提供。`);
  }

  if (!baseUrl || !model || !apiKey) {
    throw new Error("缺少 AI 参数。请通过 CLI 参数、环境变量、本地配置或交互式输入提供。");
  }

  const config = {
    baseUrl,
    model,
    apiKey,
    lang,
  };

  if (interactive && promptedForConfig && context.offerToSave !== false) {
    const shouldSave = await prompts.confirm({
      message: `是否保存 AI 配置到本机供下次复用？API Key 将明文保存到 ${configPath}`,
      default: true,
    });

    if (shouldSave) {
      await saveUserConfig(mergeAiConfig(userConfig, config), configPath);
    }
  }

  return config;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;
}

export function resolveWebPageFetcherConfig(env: NodeJS.ProcessEnv = process.env): WebPageFetcherConfig {
  return {
    firecrawlApiKey: firstNonEmpty(env.MARKSWEEP_FIRECRAWL_API_KEY, env.FIRECRAWL_API_KEY),
    firecrawlBaseUrl: firstNonEmpty(env.MARKSWEEP_FIRECRAWL_BASE_URL, env.FIRECRAWL_BASE_URL),
    jinaApiKey: firstNonEmpty(env.MARKSWEEP_JINA_API_KEY, env.JINA_API_KEY),
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function isSameFilePath(first: string, second: string): boolean {
  if (process.platform === "win32") {
    return first.toLowerCase() === second.toLowerCase();
  }

  return first === second;
}
