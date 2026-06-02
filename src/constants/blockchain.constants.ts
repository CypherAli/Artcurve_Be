// ─────────────────────────────────────────────────────────────────
//  constants/blockchain.constants.ts
//  Chain IDs, RPC endpoints, contract addresses per network
// ─────────────────────────────────────────────────────────────────

export const CHAIN_IDS = {
  BASE:         8453,
  BASE_SEPOLIA: 84532,
  HARDHAT:      31337,
} as const

export type ChainId = typeof CHAIN_IDS[keyof typeof CHAIN_IDS]

/** Contract addresses — set via env or placeholder until deployment */
export const CONTRACT_ADDRESSES: Record<number, { ArtFactory: `0x${string}`; BondingCurveAMM: `0x${string}` }> = {
  [CHAIN_IDS.BASE]: {
    ArtFactory:      (process.env.CONTRACT_ART_FACTORY_BASE      ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    BondingCurveAMM: (process.env.CONTRACT_BONDING_CURVE_BASE    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  },
  [CHAIN_IDS.BASE_SEPOLIA]: {
    ArtFactory:      (process.env.CONTRACT_ART_FACTORY_SEPOLIA   ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    BondingCurveAMM: (process.env.CONTRACT_BONDING_CURVE_SEPOLIA ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  },
}

/** Bonding curve config */
export const BONDING_CURVE = {
  TARGET_LIQUIDITY_ETH:  '24',       // graduation threshold
  PLATFORM_FEE_BPS:      100,        // 1%
  CREATOR_ROYALTY_BPS:   500,        // 5% default
  MAX_ROYALTY_BPS:       1000,       // 10% cap
  MIN_INIT_PRICE_ETH:    '0.0001',
  MAX_INIT_PRICE_ETH:    '1.0',
} as const

/** RabbitMQ queue names */
export const QUEUE_NAMES = {
  BLOCKCHAIN_EVENTS: 'blockchain.events',
  PRICE_UPDATES:     'price.updates',
  MODERATION_QUEUE:  'artwork.moderation',
} as const

/** Redis key prefixes */
export const REDIS_KEYS = {
  NONCE_PREFIX:      'nonce:',
  JWT_BLACKLIST:     'jwt:blacklist:',
  PRICE_CACHE:       'price:',
  RATE_LIMIT:        'rl:',
} as const
