export function normalizeBookmarkUrl(url: string): string {
  const trimmed = url.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const pathname = trimTrailingSlash(parsed.pathname);

    if (protocol === "http:" || protocol === "https:") {
      return `${protocol}//${host}${pathname}${parsed.search}${parsed.hash}`;
    }

    return `${protocol}${parsed.href.slice(parsed.protocol.length)}`;
  } catch {
    return trimmed;
  }
}

function trimTrailingSlash(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "";
  }

  return pathname.replace(/\/+$/, "");
}
