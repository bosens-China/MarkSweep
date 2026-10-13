import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { fetch } from "undici";
import { assertPublicUrl } from "@marksweep/core/conversation/public-url";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("undici", () => ({ fetch: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const lookupAll = lookup as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;

describe("public page address validation", () => {
  it("rejects private DNS answers, literal addresses and credentials without external DNS", async () => {
    vi.mocked(lookupAll).mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(assertPublicUrl("https://private.example/test")).rejects.toThrow("内网");
    await expect(assertPublicUrl("http://127.0.0.1/test")).rejects.toThrow("内网");
    await expect(assertPublicUrl("https://user:password@example.com")).rejects.toThrow("账号密码");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("verifies only TUN synthetic DNS answers, and fails closed on private or missing answers", async () => {
    vi.mocked(lookupAll).mockResolvedValue([{ address: "198.18.1.1", family: 4 }]);
    const response = (Answer: Array<{ type: number; data: string }>) =>
      new Response(JSON.stringify({ Answer })) as unknown as Awaited<ReturnType<typeof fetch>>;
    vi.mocked(fetch).mockResolvedValue(response([{ type: 1, data: "93.184.216.34" }]));
    await expect(assertPublicUrl("https://example.com/page")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
      expect.anything(),
    );
    vi.mocked(fetch).mockResolvedValue(response([{ type: 1, data: "192.168.1.1" }]));
    await expect(assertPublicUrl("https://example.com/page")).rejects.toThrow("内网");
    vi.mocked(fetch).mockResolvedValue(response([]));
    await expect(assertPublicUrl("https://example.com/page")).rejects.toThrow("内网");
  });
});
