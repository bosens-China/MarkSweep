import { execFileSync } from "node:child_process";
import { platform as currentPlatform } from "node:os";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export type AutoProxySource = "environment" | "macos-system";

export interface AutoProxyConfig {
  source: AutoProxySource;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

interface ResolveAutoProxyOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  scutilProxyOutput?: string;
}

export function installAutoProxy(): AutoProxyConfig | undefined {
  const config = resolveAutoProxyConfig();

  if (!config) {
    return undefined;
  }

  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      httpProxy: config.httpProxy,
      httpsProxy: config.httpsProxy,
      noProxy: config.noProxy,
    }),
  );

  return config;
}

export function resolveAutoProxyConfig(options: ResolveAutoProxyOptions = {}): AutoProxyConfig | undefined {
  const env = options.env ?? process.env;
  const envConfig = resolveEnvProxy(env);

  if (envConfig) {
    return envConfig;
  }

  if ((options.platform ?? currentPlatform()) !== "darwin") {
    return undefined;
  }

  return resolveMacOsProxy(options.scutilProxyOutput ?? readMacOsProxy());
}

function resolveEnvProxy(env: NodeJS.ProcessEnv): AutoProxyConfig | undefined {
  const httpProxy = firstSet(env.http_proxy, env.HTTP_PROXY);
  const httpsProxy = firstSet(env.https_proxy, env.HTTPS_PROXY);

  if (!httpProxy && !httpsProxy) {
    return undefined;
  }

  return {
    source: "environment",
    httpProxy,
    httpsProxy,
    noProxy: firstSet(env.no_proxy, env.NO_PROXY),
  };
}

function resolveMacOsProxy(output: string): AutoProxyConfig | undefined {
  const values = parseScutilProxy(output);
  const httpProxy = buildProxyUrl("http", values.HTTPEnable, values.HTTPProxy, values.HTTPPort);
  const httpsProxy = buildProxyUrl("http", values.HTTPSEnable, values.HTTPSProxy, values.HTTPSPort);
  const socksProxy = buildProxyUrl("socks5", values.SOCKSEnable, values.SOCKSProxy, values.SOCKSPort);
  const noProxy = Array.isArray(values.ExceptionsList) ? values.ExceptionsList.join(",") : undefined;

  if (!httpProxy && !httpsProxy && !socksProxy) {
    return undefined;
  }

  return {
    source: "macos-system",
    httpProxy: httpProxy ?? socksProxy,
    httpsProxy: httpsProxy ?? socksProxy,
    noProxy,
  };
}

function readMacOsProxy(): string {
  try {
    return execFileSync("scutil", ["--proxy"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function parseScutilProxy(output: string): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  const exceptions: string[] = [];
  let inExceptions = false;

  for (const line of output.split(/\r?\n/)) {
    if (line.includes("ExceptionsList : <array>")) {
      inExceptions = true;
      continue;
    }

    if (inExceptions) {
      if (/^\s*}\s*$/.test(line)) {
        inExceptions = false;
        continue;
      }

      const exceptionMatch = line.match(/^\s*\d+\s*:\s*(.+)\s*$/);
      if (exceptionMatch?.[1]) {
        exceptions.push(exceptionMatch[1].trim());
      }
      continue;
    }

    const match = line.match(/^\s*([A-Za-z0-9]+)\s*:\s*(.+)\s*$/);
    if (match?.[1] && match[2]) {
      values[match[1]] = match[2].trim();
    }
  }

  if (exceptions.length > 0) {
    values.ExceptionsList = exceptions;
  }

  return values;
}

function buildProxyUrl(
  protocol: "http" | "socks5",
  enabled: unknown,
  host: unknown,
  port: unknown,
): string | undefined {
  if (enabled !== "1" || typeof host !== "string" || typeof port !== "string") {
    return undefined;
  }

  const parsedPort = Number.parseInt(port, 10);
  if (!host || !Number.isInteger(parsedPort) || parsedPort <= 0) {
    return undefined;
  }

  return `${protocol}://${formatProxyHost(host)}:${parsedPort}`;
}

function formatProxyHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function firstSet(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}
