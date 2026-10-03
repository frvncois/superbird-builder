// Outbound-request guard: never let a URL an untrusted party influenced become
// a probe into the operator's network.
//
// The webhook forward (public/deliver.mjs) and the capability test both POST to
// a URL an admin typed into an integration. That request runs on the operator's
// machine with their network access, so a hostname check alone is not enough: a
// perfectly public name can resolve to 169.254.169.254 (cloud metadata), and a
// 302 hands the request to any host at all. Every URL is resolved and
// range-checked before it is used, and redirects are never followed
// (`redirect: 'manual'` at every call site).
//
// Caveat worth knowing: resolve-then-connect leaves a TOCTOU window — the name
// could resolve differently for the actual connection. Closing it needs a
// custom agent that pins the checked address; this raises the bar a long way
// without that machinery.
//
// NOTE: packages/guano/mcp/tools.mjs carries the same three functions for
// `upload_media {url}`. They are deliberately NOT shared: the MCP package is
// packed with `server/` beside it (`../server/…`) while in the repo it sits
// three levels up, and a static import cannot do that dual-path fallback. If
// you change the ranges here, change them there.

/** RFC1918, loopback, link-local, CGNAT, multicast — and anything unparseable */
export function isPrivateIpv4(ip) {
  const p = String(ip).split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local — the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  )
}

export function isPrivateIpv6(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '')
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true
  const mapped = v.match(/(\d+\.\d+\.\d+\.\d+)$/) // ::ffff:169.254.169.254
  return mapped ? isPrivateIpv4(mapped[1]) : false
}

/**
 * Throws unless this URL is https and every address it resolves to is public.
 * `resolve` is injected so a test can drive it without DNS.
 */
export async function assertPublicUrl(parsed, resolve) {
  if (parsed.protocol !== 'https:') {
    throw new Error(`url must be https:// (got ${parsed.protocol}//)`)
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`url must point at a public host — "${host}" is local`)
  }
  const literal = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')
  const addresses = literal
    ? [host]
    : await resolve(host, { all: true }).then(
        (rows) => rows.map((r) => r.address),
        (e) => {
          throw new Error(`could not resolve "${host}": ${e.message ?? e}`)
        },
      )
  if (!addresses.length) throw new Error(`"${host}" resolved to no addresses`)
  for (const address of addresses) {
    const priv = address.includes(':') ? isPrivateIpv6(address) : isPrivateIpv4(address)
    if (priv) {
      throw new Error(
        `url must point at a public host — "${host}" resolves to ${address}, a private address`,
      )
    }
  }
}
