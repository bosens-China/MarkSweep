import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/server/src/app";
import { saveUserConfig, loadUserConfig } from "@marksweep/core/config/user-config";

const origin = "http://127.0.0.1:4010";
const app = createApp(new Set([origin]));
const post = (body: unknown) =>
  app.request(origin + "/api/config", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());

async function configFile() {
  const directory = await mkdtemp(path.join(tmpdir(), "marksweep-ui-config-"));
  const configPath = path.join(directory, "config.json");
  vi.stubEnv("MARKSWEEP_CONFIG_PATH", configPath);
  return { configPath, directory };
}

describe("saving local AI configuration", () => {
  it("ignores blank environment values when displaying saved defaults", async () => {
    const { configPath } = await configFile();
    await saveUserConfig(
      { version: 1, ai: { model: "saved-model", baseUrl: "https://saved.example/v1", apiKey: "saved-key" } },
      configPath,
    );
    for (const name of [
      "MARKSWEEP_AI_MODEL",
      "OPENAI_MODEL",
      "MARKSWEEP_AI_BASE_URL",
      "OPENAI_BASE_URL",
      "MARKSWEEP_AI_API_KEY",
      "OPENAI_API_KEY",
    ])
      vi.stubEnv(name, " ");
    const response = await app.request(origin + "/api/config");
    expect(await response.json()).toMatchObject({
      ai: { model: "saved-model", baseUrl: "https://saved.example/v1" },
      hasApiKey: true,
    });
  });
  it("requires an explicit save flag and does not overwrite on invalid input", async () => {
    const { configPath } = await configFile();
    await saveUserConfig({ version: 1, ai: { model: "original", apiKey: "existing-secret" } }, configPath);
    const original = await readFile(configPath, "utf8");
    expect((await post({ ai: { model: "changed" } })).status).toBe(400);
    expect((await post({ confirmSave: true, ai: { baseUrl: "javascript:alert(1)" } })).status).toBe(400);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
  it("preserves a stored key when the form is blank and returns no secrets", async () => {
    const { configPath, directory } = await configFile();
    await saveUserConfig({ version: 1, ai: { model: "old", apiKey: "existing-secret" } }, configPath);
    const response = await post({
      confirmSave: true,
      ai: { model: " new-model ", apiKey: "", baseUrl: "https://api.example.com/v1", compatibility: "deepseek" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("existing-secret");
    expect((await loadUserConfig(configPath)).ai).toMatchObject({
      model: "new-model",
      apiKey: "existing-secret",
      compatibility: "deepseek",
    });
    expect(await readdir(directory)).toEqual(["config.json"]);
  });
  it("saves a supplied key without returning it to the browser", async () => {
    const { configPath } = await configFile();
    const response = await post({ confirmSave: true, ai: { model: "test-model", apiKey: "new-secret" } });
    const text = await response.text();
    expect(text).not.toContain("new-secret");
    expect(JSON.parse(text)).toMatchObject({ hasApiKey: true, configPath });
    expect((await loadUserConfig(configPath)).ai?.apiKey).toBe("new-secret");
  });
});
