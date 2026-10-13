import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fetch } from "undici";
import { z } from "zod";

const dnsAnswerSchema = z.object({ Answer: z.array(z.object({ type: z.number(), data: z.string() })).default([]) });

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{0,3}:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a !== undefined &&
    b !== undefined &&
    a > 0 &&
    a < 224 &&
    ![10, 127].includes(a) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 198 && [18, 19].includes(b))
  );
}

export async function assertPublicUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("只允许不含账号密码的公开 HTTP(S) 页面。");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  // TUN 的 fake-ip 不是目标主机地址，仅对此合成网段用公开 DNS 复核，其他内网解析仍拒绝。
  if (!isIP(hostname) && addresses.length && addresses.every(({ address }) => /^198\.(18|19)\./.test(address))) {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("无法核实 TUN DNS 地址，请检查网络后重试。");
    addresses = dnsAnswerSchema
      .parse(await response.json())
      .Answer.filter((answer) => answer.type === 1)
      .map(({ data }) => ({ address: data }));
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("不采集本机、内网或保留地址。");
}
