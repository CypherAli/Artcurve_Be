// ─────────────────────────────────────────────────────────────────
//  helpers/eth.helper.ts
//  ETH / token amount formatters
//  Uses string arithmetic to avoid BigInt import overhead in hot paths
// ─────────────────────────────────────────────────────────────────

/** Wei (bigint) → ETH string, 8 decimal places */
export function weiToEth(wei: bigint): string {
  const ETH = BigInt('1000000000000000000')
  const whole = wei / ETH
  const frac  = wei % ETH
  return `${whole}.${frac.toString().padStart(18, '0').slice(0, 8)}`
}

/** ETH string → Wei bigint */
export function ethToWei(eth: string): bigint {
  const [whole = '0', frac = ''] = eth.split('.')
  const paddedFrac = frac.padEnd(18, '0').slice(0, 18)
  return BigInt(whole) * BigInt('1000000000000000000') + BigInt(paddedFrac)
}

/** Format a DECIMAL(18,8) string from DB for display: "0.00100000" → "0.001 ETH" */
export function formatEthDisplay(raw: string): string {
  const n = parseFloat(raw)
  if (!isFinite(n)) return '— ETH'
  if (n >= 1000)  return `${(n / 1000).toFixed(2)}k ETH`
  if (n >= 1)     return `${n.toFixed(3)} ETH`
  return `${n.toFixed(6)} ETH`
}

/** Percentage change between two price strings */
export function pctChange(from: string, to: string): number {
  const f = parseFloat(from), t = parseFloat(to)
  if (!f) return 0
  return ((t - f) / f) * 100
}
