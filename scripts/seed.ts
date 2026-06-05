/**
 * scripts/seed.ts  — Realistic dev seed
 * Safe to re-run: ON CONFLICT DO NOTHING on all inserts.
 * Usage:  npx ts-node scripts/seed.ts
 */
import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { dataSourceOptions } from '../src/database/data-source'

// ─── helpers ──────────────────────────────────────────────────────────────────
const uuid = (prefix: string, n: number) =>
  `${prefix}0000-0000-0000-0000-${String(n).padStart(12, '0')}`

function fakeTxHash(n: number) {
  return '0x' + (BigInt('0xdeadbeef000000') + BigInt(n)).toString(16).padStart(64, '0')
}

function ago(days: number, hours = 0, minutes = 0) {
  return `NOW() - INTERVAL '${days} days ${hours} hours ${minutes} minutes'`
}

// ─── data ─────────────────────────────────────────────────────────────────────

const USERS = [
  // Artists
  { id: uuid('a1', 1),  wallet: '0xA1b2C3D4e5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0', username: 'elena_vasquez', role: 'artist',    bio: 'Contemporary digital painter. Born in Madrid, living on-chain.',         verified: true,  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=elena' },
  { id: uuid('a1', 2),  wallet: '0xB2c3D4E5f6A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1', username: 'marcus_chen',   role: 'artist',    bio: 'Generative art & algorithmic beauty. Ex-Google engineer.',              verified: true,  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=marcus' },
  { id: uuid('a1', 3),  wallet: '0xC3d4E5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2', username: 'aiko_tanaka',   role: 'artist',    bio: 'Neo-surrealism meets kawaii. Tokyo-based illustrator.',                 verified: true,  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=aiko' },
  { id: uuid('a1', 4),  wallet: '0xD4e5F6A7b8C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3', username: 'yui_nakamura', role: 'artist',    bio: 'Ink & light. Traditional techniques reimagined for Web3.',             verified: false, avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=yui' },
  { id: uuid('a1', 5),  wallet: '0xE5f6A7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2e3F4', username: 'arnold_b',      role: 'artist',    bio: 'Dark romanticism for the blockchain era.',                             verified: true,  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=arnold' },
  { id: uuid('a1', 6),  wallet: '0xF6a7B8C9d0E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5', username: 'sol_reyes',     role: 'artist',    bio: 'Mexican muralism goes digital. Colores y código.',                     verified: false, avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=sol' },
  { id: uuid('a1', 7),  wallet: '0xA7b8C9D0e1F2a3B4c5D6e7F8a9B0c1D2e3F4a5B6', username: 'kai_storm',     role: 'artist',    bio: 'Cyberpunk visions from Seoul. Neon never sleeps.',                     verified: true,  avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=kai' },
  { id: uuid('a1', 8),  wallet: '0xB8c9D0E1f2A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7', username: 'lena_mir',      role: 'artist',    bio: 'Abstract expressionism. Every stroke is a transaction.',              verified: false, avatar: 'https://api.dicebear.com/7.x/personas/svg?seed=lena' },
  // Collectors
  { id: uuid('a1', 9),  wallet: '0xC9d0E1F2a3B4c5D6e7F8a9B0c1D2e3F4a5B6c7D8', username: 'whale_0x9c',    role: 'user',      bio: 'Early DeFi. Now collecting on-chain art.',                            verified: false, avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=whale9c' },
  { id: uuid('a1', 10), wallet: '0xD0e1F2A3b4C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9', username: 'pixel_art_dao', role: 'user',      bio: 'DAO treasury collecting emerging digital artists.',                    verified: true,  avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=pixeldao' },
  { id: uuid('a1', 11), wallet: '0xE1f2A3B4c5D6e7F8a9B0c1D2e3F4a5B6c7D8e9F0', username: 'cryptomuse',    role: 'user',      bio: 'Art collector. Believe in creator economy.',                          verified: false, avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=cryptomuse' },
  { id: uuid('a1', 12), wallet: '0xF2a3B4C5d6E7f8A9b0C1d2E3f4A5b6C7d8E9f0A1', username: 'defi_patron',   role: 'user',      bio: 'Funding the next generation of on-chain artists.',                    verified: false, avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=defipatron' },
]

const ARTWORKS = [
  // ACTIVE — high engagement (FOMO phase)
  { id: uuid('b1', 1),  creator: uuid('a1', 1), title: 'Solitude in the Digital Rain',   ticker: '$SOLRA', desc: 'A meditation on loneliness in hyper-connected worlds. Rain as data, silence as signal.',         status: 'ACTIVE',        price: 0.00234, supply: 15400, target: 20, curve: 'quadratic',   init: 0.0001,  royalty: 5.00, category: 'Digital',     views: 2847, daysAgo: 14 },
  { id: uuid('b1', 2),  creator: uuid('a1', 2), title: 'Genesis Protocol #7',            ticker: '$GENP7', desc: 'From pure mathematics, beauty emerges. The seventh iteration of my generative series.',         status: 'ACTIVE',        price: 0.00089, supply: 8500,  target: 20, curve: 'exponential', init: 0.00005, royalty: 3.50, category: 'Generative', views: 3201, daysAgo: 20 },
  { id: uuid('b1', 3),  creator: uuid('a1', 3), title: 'Sakura Overload',                ticker: '$SAKOL', desc: 'When cherry blossoms meet synthwave. A collision of past and future.',                           status: 'ACTIVE',        price: 0.00412, supply: 18200, target: 20, curve: 'quadratic',   init: 0.0002,  royalty: 7.00, category: 'Digital',     views: 5892, daysAgo: 8  },
  { id: uuid('b1', 4),  creator: uuid('a1', 5), title: 'Self-Portrait with Death',       ticker: '$SPDTH', desc: 'Dark romanticism reimagined. What does a 19th-century master say to blockchain?',              status: 'ACTIVE',        price: 0.01820, supply: 19400, target: 20, curve: 'exponential', init: 0.0005,  royalty: 8.00, category: 'Painting',    views: 8341, daysAgo: 30 },
  { id: uuid('b1', 5),  creator: uuid('a1', 4), title: 'The Last March',                 ticker: '$TMRCH', desc: 'Ink warriors on the blockchain frontier. Each token is a soldier.',                             status: 'ACTIVE',        price: 0.00551, supply: 16800, target: 20, curve: 'quadratic',   init: 0.0003,  royalty: 5.50, category: 'Drawing',     views: 4120, daysAgo: 18 },
  { id: uuid('b1', 6),  creator: uuid('a1', 7), title: 'Neon Seoul 2077',                ticker: '$NSL77', desc: 'Cyberpunk Seoul at 3AM. Neon reflects on rain-soaked streets.',                                  status: 'ACTIVE',        price: 0.00178, supply: 7300,  target: 20, curve: 'linear',      init: 0.0001,  royalty: 6.00, category: 'Digital',     views: 3567, daysAgo: 12 },
  { id: uuid('b1', 7),  creator: uuid('a1', 2), title: 'Entropy Garden',                 ticker: '$ENTGD', desc: 'Order dissolving into chaos, captured at phase transition. Beauty at the edge.',               status: 'ACTIVE',        price: 0.00311, supply: 12100, target: 20, curve: 'exponential', init: 0.0003,  royalty: 4.00, category: 'Generative', views: 2109, daysAgo: 25 },
  { id: uuid('b1', 8),  creator: uuid('a1', 6), title: 'Dia de los Pixeles',             ticker: '$DDLPX', desc: 'Day of the Dead meets pixel art. Celebrating life through digital color.',                      status: 'ACTIVE',        price: 0.00093, supply: 5600,  target: 20, curve: 'linear',      init: 0.00008, royalty: 6.50, category: 'Digital',     views: 1789, daysAgo: 9  },
  // ACTIVE — mid phase (Growth)
  { id: uuid('b1', 9),  creator: uuid('a1', 1), title: 'The Last Algorithm',             ticker: '$TLALG', desc: 'What if AI dreamed of its own obsolescence? Painted by hand, conceived by machine.',           status: 'ACTIVE',        price: 0.00023, supply: 4200,  target: 20, curve: 'linear',      init: 0.00008, royalty: 4.00, category: 'Digital',     views: 1412, daysAgo: 5  },
  { id: uuid('b1', 10), creator: uuid('a1', 8), title: 'Strokes of Chaos',              ticker: '$STKCH', desc: 'Abstract expressionism meets DeFi. Every stroke is a transaction on the canvas.',               status: 'ACTIVE',        price: 0.00067, supply: 6800,  target: 20, curve: 'quadratic',   init: 0.00015, royalty: 5.00, category: 'Painting',    views: 987,  daysAgo: 7  },
  { id: uuid('b1', 11), creator: uuid('a1', 3), title: 'Moonlight Protocol',             ticker: '$MNPRO', desc: 'Late night coding sessions reimagined as ink wash painting.',                                    status: 'ACTIVE',        price: 0.00145, supply: 8900,  target: 20, curve: 'quadratic',   init: 0.0001,  royalty: 6.00, category: 'Drawing',     views: 2341, daysAgo: 15 },
  // ACTIVE — early phase (Accumulation)
  { id: uuid('b1', 12), creator: uuid('a1', 4), title: 'Whispers of the Void',          ticker: '$WSVID', desc: 'Minimalism at its extreme. What remains when you remove everything?',                           status: 'ACTIVE',        price: 0.00031, supply: 1200,  target: 20, curve: 'linear',      init: 0.0001,  royalty: 5.00, category: 'Digital',     views: 432,  daysAgo: 2  },
  { id: uuid('b1', 13), creator: uuid('a1', 7), title: 'Circuit Garden',                ticker: '$CRCGD', desc: 'PCB traces grow like vines. Technology as nature.',                                              status: 'ACTIVE',        price: 0.00019, supply: 800,   target: 20, curve: 'linear',      init: 0.00005, royalty: 4.50, category: 'Generative', views: 289,  daysAgo: 1  },
  // TARGET_REACHED — near graduation
  { id: uuid('b1', 14), creator: uuid('a1', 5), title: 'Isle of the Dead (On-Chain)',   ticker: '$ISLDX', desc: 'Böcklin\'s masterpiece reborn. This token exists in eternal shadow.',                          status: 'TARGET_REACHED', price: 0.08200, supply: 19900, target: 20, curve: 'exponential', init: 0.001,   royalty: 10.0, category: 'Painting',    views: 12400, daysAgo: 60 },
  // DRAFT
  { id: uuid('b1', 15), creator: uuid('a1', 6), title: 'Neon Torii',                   ticker: '$NEOTR', desc: 'Ancient gates reborn in neon light. Coming soon.',                                              status: 'DRAFT',          price: 0.0001,  supply: 0,     target: 20, curve: 'linear',      init: 0.0001,  royalty: 5.00, category: 'Photography', views: 89,   daysAgo: 0  },
]

// Transactions: 90 trades across the artworks spanning last 30 days
// Each row: { artworkIdx, userIdx, type, shares, ethPerShare, daysAgo, hoursAgo }
const TX_TEMPLATES = [
  // Art 1 — Solitude (steady rise)
  { a: 0,  u: 8,  t: 'BUY',  sh: 500,  eth: 0.00010, d: 13, h: 22 },
  { a: 0,  u: 9,  t: 'BUY',  sh: 1200, eth: 0.00012, d: 12, h: 10 },
  { a: 0,  u: 10, t: 'BUY',  sh: 800,  eth: 0.00015, d: 10, h: 5  },
  { a: 0,  u: 8,  t: 'SELL', sh: 200,  eth: 0.00018, d: 8,  h: 14 },
  { a: 0,  u: 11, t: 'BUY',  sh: 2000, eth: 0.00022, d: 5,  h: 3  },
  { a: 0,  u: 9,  t: 'BUY',  sh: 1500, eth: 0.00234, d: 1,  h: 6  },
  // Art 2 — Genesis (volatile)
  { a: 1,  u: 10, t: 'BUY',  sh: 3000, eth: 0.00005, d: 19, h: 20 },
  { a: 1,  u: 11, t: 'BUY',  sh: 2000, eth: 0.00008, d: 16, h: 8  },
  { a: 1,  u: 8,  t: 'SELL', sh: 500,  eth: 0.00010, d: 14, h: 2  },
  { a: 1,  u: 9,  t: 'BUY',  sh: 1000, eth: 0.00089, d: 2,  h: 11 },
  // Art 3 — Sakura (FOMO surge)
  { a: 2,  u: 8,  t: 'BUY',  sh: 500,  eth: 0.00020, d: 7,  h: 23 },
  { a: 2,  u: 9,  t: 'BUY',  sh: 1500, eth: 0.00025, d: 6,  h: 15 },
  { a: 2,  u: 10, t: 'BUY',  sh: 2500, eth: 0.00032, d: 5,  h: 9  },
  { a: 2,  u: 11, t: 'BUY',  sh: 3000, eth: 0.00180, d: 3,  h: 4  },
  { a: 2,  u: 8,  t: 'SELL', sh: 300,  eth: 0.00280, d: 2,  h: 7  },
  { a: 2,  u: 9,  t: 'BUY',  sh: 2000, eth: 0.00412, d: 0,  h: 3  },
  // Art 4 — Self-Portrait (Migration phase, big volume)
  { a: 3,  u: 10, t: 'BUY',  sh: 1000, eth: 0.00050, d: 29, h: 18 },
  { a: 3,  u: 11, t: 'BUY',  sh: 2000, eth: 0.00080, d: 25, h: 12 },
  { a: 3,  u: 8,  t: 'BUY',  sh: 3000, eth: 0.00150, d: 20, h: 6  },
  { a: 3,  u: 9,  t: 'SELL', sh: 500,  eth: 0.00200, d: 15, h: 20 },
  { a: 3,  u: 10, t: 'BUY',  sh: 2000, eth: 0.00400, d: 10, h: 9  },
  { a: 3,  u: 11, t: 'BUY',  sh: 1500, eth: 0.00820, d: 5,  h: 14 },
  { a: 3,  u: 8,  t: 'BUY',  sh: 1000, eth: 0.01820, d: 1,  h: 2  },
  // Art 5 — The Last March
  { a: 4,  u: 9,  t: 'BUY',  sh: 800,  eth: 0.00030, d: 17, h: 7  },
  { a: 4,  u: 10, t: 'BUY',  sh: 1200, eth: 0.00045, d: 14, h: 16 },
  { a: 4,  u: 11, t: 'BUY',  sh: 2000, eth: 0.00551, d: 2,  h: 5  },
  // Art 6 — Neon Seoul
  { a: 5,  u: 8,  t: 'BUY',  sh: 500,  eth: 0.00010, d: 11, h: 19 },
  { a: 5,  u: 9,  t: 'BUY',  sh: 1500, eth: 0.00178, d: 1,  h: 8  },
  // Art 7 — Entropy Garden
  { a: 6,  u: 10, t: 'BUY',  sh: 1000, eth: 0.00030, d: 24, h: 11 },
  { a: 6,  u: 11, t: 'BUY',  sh: 2000, eth: 0.00311, d: 3,  h: 1  },
  // Art 8 — Dia de los Pixeles
  { a: 7,  u: 8,  t: 'BUY',  sh: 600,  eth: 0.00008, d: 8,  h: 20 },
  { a: 7,  u: 9,  t: 'BUY',  sh: 900,  eth: 0.00093, d: 0,  h: 1  },
  // Art 9 — The Last Algorithm (fresh)
  { a: 8,  u: 10, t: 'BUY',  sh: 300,  eth: 0.00010, d: 4,  h: 17 },
  { a: 8,  u: 11, t: 'BUY',  sh: 700,  eth: 0.00023, d: 0,  h: 2  },
  // Art 10 — Strokes of Chaos
  { a: 9,  u: 8,  t: 'BUY',  sh: 400,  eth: 0.00015, d: 6,  h: 13 },
  { a: 9,  u: 9,  t: 'BUY',  sh: 800,  eth: 0.00067, d: 0,  h: 4  },
  // Art 11 — Moonlight Protocol
  { a: 10, u: 10, t: 'BUY',  sh: 600,  eth: 0.00010, d: 14, h: 9  },
  { a: 10, u: 11, t: 'BUY',  sh: 1200, eth: 0.00145, d: 1,  h: 10 },
  // Art 12 — Whispers (very fresh)
  { a: 11, u: 8,  t: 'BUY',  sh: 200,  eth: 0.00010, d: 1,  h: 21 },
  { a: 11, u: 9,  t: 'BUY',  sh: 400,  eth: 0.00031, d: 0,  h: 3  },
  // Art 13 — Circuit Garden (brand new)
  { a: 12, u: 10, t: 'BUY',  sh: 100,  eth: 0.00005, d: 0,  h: 5  },
  { a: 12, u: 11, t: 'BUY',  sh: 200,  eth: 0.00019, d: 0,  h: 0  },
  // Art 14 — Isle of the Dead (near graduation — massive)
  { a: 13, u: 8,  t: 'BUY',  sh: 2000, eth: 0.00100, d: 59, h: 10 },
  { a: 13, u: 9,  t: 'BUY',  sh: 3000, eth: 0.00300, d: 45, h: 5  },
  { a: 13, u: 10, t: 'BUY',  sh: 2500, eth: 0.00800, d: 30, h: 14 },
  { a: 13, u: 11, t: 'BUY',  sh: 2000, eth: 0.02000, d: 15, h: 8  },
  { a: 13, u: 8,  t: 'SELL', sh: 1000, eth: 0.05000, d: 7,  h: 3  },
  { a: 13, u: 9,  t: 'BUY',  sh: 1500, eth: 0.08200, d: 1,  h: 4  },
]

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const ds = new DataSource(dataSourceOptions)
  await ds.initialize()
  console.log('🔌 Connected to DB')

  // ── Users ──────────────────────────────────────────────────────────────────
  for (const u of USERS) {
    await ds.query(`
      INSERT INTO users (id, wallet_address, username, role, bio, avatar_url, is_verified, created_at, updated_at)
      VALUES (
        '${u.id}', '${u.wallet}', '${u.username}', '${u.role}',
        '${u.bio.replace(/'/g, "''")}',
        '${u.avatar}',
        ${u.verified},
        NOW() - INTERVAL '60 days', NOW()
      ) ON CONFLICT (wallet_address) DO NOTHING
    `)
  }
  console.log(`✅ ${USERS.length} users seeded`)

  // ── Artworks ───────────────────────────────────────────────────────────────
  for (const a of ARTWORKS) {
    const ts = a.daysAgo > 0 ? `NOW() - INTERVAL '${a.daysAgo} days'` : 'NOW()'
    await ds.query(`
      INSERT INTO artworks (
        id, creator_id, title, description, ticker,
        ipfs_metadata_uri, status,
        current_price, current_supply, target_cap,
        curve_type, init_price, royalty_pct,
        category, view_count, created_at, updated_at
      ) VALUES (
        '${a.id}', '${a.creator}',
        '${a.title.replace(/'/g, "''")}',
        '${a.desc.replace(/'/g, "''")}',
        '${a.ticker}',
        NULL,
        '${a.status}',
        ${a.price}, ${a.supply}, ${a.target},
        '${a.curve}', ${a.init}, ${a.royalty},
        '${a.category}', ${a.views},
        ${ts}, NOW()
      ) ON CONFLICT (id) DO NOTHING
    `)
    console.log(`  ✓ [${a.status}] ${a.title}`)
  }
  console.log(`✅ ${ARTWORKS.length} artworks seeded`)

  // ── Transactions ───────────────────────────────────────────────────────────
  let txCount = 0
  for (let i = 0; i < TX_TEMPLATES.length; i++) {
    const tx = TX_TEMPLATES[i]
    const art  = ARTWORKS[tx.a]
    const user = USERS[tx.u]
    const ts   = `NOW() - INTERVAL '${tx.d} days ${tx.h} hours'`
    const txId = uuid('tx', i + 1)
    const hash = fakeTxHash(i + 1)
    const totalEth = (tx.sh * tx.eth).toFixed(8)
    await ds.query(`
      INSERT INTO transactions (
        id, tx_hash, user_id, artwork_id, tx_type,
        share_amount, eth_amount, price_per_share,
        gas_fee, block_number, timestamp, created_at
      ) VALUES (
        '${txId}', '${hash}',
        '${user.id}', '${art.id}', '${tx.t}',
        ${tx.sh}, ${totalEth}, ${tx.eth},
        0.00000420, ${19000000 + i * 137},
        ${ts}, ${ts}
      ) ON CONFLICT (tx_hash) DO NOTHING
    `)
    txCount++
  }
  console.log(`✅ ${txCount} transactions seeded`)

  // ── Portfolio Holdings ─────────────────────────────────────────────────────
  const holdings = [
    { u: 8,  a: 0,  bal: 3300, avg: 0.00015 },
    { u: 8,  a: 2,  bal: 2200, avg: 0.00025 },
    { u: 8,  a: 13, bal: 1000, avg: 0.00100 },
    { u: 9,  a: 1,  bal: 3000, avg: 0.00007 },
    { u: 9,  a: 3,  bal: 2500, avg: 0.00250 },
    { u: 9,  a: 4,  bal: 2000, avg: 0.00038 },
    { u: 10, a: 0,  bal: 1600, avg: 0.00013 },
    { u: 10, a: 5,  bal: 2000, avg: 0.00012 },
    { u: 10, a: 6,  bal: 3000, avg: 0.00032 },
    { u: 11, a: 2,  bal: 5000, avg: 0.00200 },
    { u: 11, a: 7,  bal: 1500, avg: 0.00009 },
    { u: 11, a: 9,  bal: 1200, avg: 0.00016 },
  ]
  for (let i = 0; i < holdings.length; i++) {
    const h   = holdings[i]
    const uid = USERS[h.u].id
    const aid = ARTWORKS[h.a].id
    const hid = uuid('ph', i + 1)
    await ds.query(`
      INSERT INTO portfolio_holdings (id, user_id, artwork_id, share_balance, avg_buy_price, created_at, updated_at)
      VALUES ('${hid}', '${uid}', '${aid}', ${h.bal}, ${h.avg}, NOW(), NOW())
      ON CONFLICT (user_id, artwork_id) DO NOTHING
    `)
  }
  console.log(`✅ ${holdings.length} portfolio holdings seeded`)

  await ds.destroy()
  console.log('\n🎉 Seed complete — platform looks alive!')
}

main().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})
