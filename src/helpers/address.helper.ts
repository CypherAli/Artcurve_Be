// ─────────────────────────────────────────────────────────────────
//  helpers/address.helper.ts
//  Ethereum address utilities
// ─────────────────────────────────────────────────────────────────

/** Validate EIP-55 checksum address or lowercase hex address */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/** Normalise to lowercase — use before DB storage */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase()
}

/** "0x4f2a...a91b" — display truncation */
export function truncateAddress(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length < head + tail + 2) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

/** Compare two addresses case-insensitively */
export function isSameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
