import { describe, expect, it } from "vitest";
import { resolveAutoProxyConfig } from "../../src/cli/proxy";

describe("auto proxy", () => {
  it("uses proxy environment variables first", () => {
    expect(
      resolveAutoProxyConfig({
        env: {
          HTTPS_PROXY: "http://127.0.0.1:7890",
          NO_PROXY: "localhost,127.0.0.1",
        },
        platform: "darwin",
        scutilProxyOutput: macOsProxyOutput(),
      }),
    ).toEqual({
      source: "environment",
      httpProxy: undefined,
      httpsProxy: "http://127.0.0.1:7890",
      noProxy: "localhost,127.0.0.1",
    });
  });

  it("reads static macOS system proxy settings", () => {
    expect(
      resolveAutoProxyConfig({
        env: {},
        platform: "darwin",
        scutilProxyOutput: macOsProxyOutput(),
      }),
    ).toEqual({
      source: "macos-system",
      httpProxy: "http://127.0.0.1:12450",
      httpsProxy: "http://127.0.0.1:12450",
      noProxy: "*.local,169.254/16",
    });
  });

  it("falls back to SOCKS proxy when web proxies are disabled", () => {
    expect(
      resolveAutoProxyConfig({
        env: {},
        platform: "darwin",
        scutilProxyOutput: `
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : 127.0.0.1
}
`,
      }),
    ).toMatchObject({
      httpProxy: "socks5://127.0.0.1:1080",
      httpsProxy: "socks5://127.0.0.1:1080",
    });
  });
});

function macOsProxyOutput(): string {
  return `
<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 12450
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 12450
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 12450
  SOCKSProxy : 127.0.0.1
}
`;
}
