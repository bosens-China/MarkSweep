import { loadUserConfig, saveUserConfig, getDefaultUserConfigPath } from "@marksweep/core/config/user-config";
import { aiOptionsSchema, type AiOptions, type PublicConfig } from "@marksweep/core/protocol";

export async function getPublicConfig(): Promise<PublicConfig> {
  const { ai } = await loadUserConfig();
  const env = process.env;
  const first = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim();
  const compatibility = first(env.MARKSWEEP_AI_COMPATIBILITY, ai?.compatibility) ?? "auto";
  return {
    configPath: getDefaultUserConfigPath(),
    ai: {
      baseUrl: first(env.MARKSWEEP_AI_BASE_URL, env.OPENAI_BASE_URL, ai?.baseUrl) ?? "https://api.openai.com/v1",
      model: first(env.MARKSWEEP_AI_MODEL, env.OPENAI_MODEL, ai?.model) ?? "",
      lang: first(env.MARKSWEEP_LANG, ai?.lang) ?? "zh",
      compatibility: compatibility === "deepseek" || compatibility === "openai" ? compatibility : "auto",
    },
    hasApiKey: Boolean(first(env.MARKSWEEP_AI_API_KEY, env.OPENAI_API_KEY, ai?.apiKey)),
    langsmith:
      !["false", "0", "no", "off"].includes((env.LANGSMITH_TRACING ?? "").trim().toLowerCase()) &&
      Boolean(env.LANGSMITH_API_KEY && env.LANGSMITH_PROJECT),
  };
}

export async function saveAiSettings(value: AiOptions): Promise<PublicConfig> {
  const input = aiOptionsSchema.parse(value);
  const current = await loadUserConfig();
  const fields = Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
      .map(([key, text]) => [key, text.trim()]),
  );
  await saveUserConfig({ ...current, ai: { ...current.ai, ...fields } });
  return getPublicConfig();
}
