/** Validate an operator-configured AI endpoint before making a server-side request.
 * HTTPS alone is insufficient: reject local/private IP literals and local hostnames.
 * DNS resolution and egress firewall controls remain separate deployment requirements. */
export function isSafeAiHostBaseUrl(value) {

  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
      || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test")) return false;
    // IPv6 literals are bracketed by URL.hostname in some runtimes.
    // Reject IPv6 literals altogether. Provider endpoints should use a DNS hostname;
    // this avoids incomplete allow/deny lists for IPv6 special-purpose ranges.
    if (hostname.includes(":")) return false;
    const parts = hostname.split(".");
    if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
      const [a, b] = parts.map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
        || (a === 192 && (b === 0 || b === 88))
        || (a === 198 && (b === 18 || b === 19 || b === 51))
        || (a === 203 && b === 0 && Number(parts[2]) === 113)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
