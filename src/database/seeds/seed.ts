/**
 * Seeder — bơm dữ liệu giả vào DB để test N+1, indexes, và service logic
 * Chạy: npx ts-node src/database/seeds/seed.ts
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import AppDataSource from '../data-source';
import { User } from '../../modules/users/entities/user.entity';
import { Artwork, ArtworkStatus } from '../../modules/artworks/entities/artwork.entity';
import { Transaction, TransactionType } from '../../modules/trades/entities/transaction.entity';
import { PortfolioHolding } from '../../modules/portfolio/entities/portfolio-holding.entity';
import { Follower } from '../../modules/social/entities/follower.entity';
import { SocialInteraction, InteractionType } from '../../modules/social/entities/social-interaction.entity';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Tạo địa chỉ ví ETH giả — đúng format 0x + 40 hex chars */
function fakeWallet(index: number): string {
  return `0x${index.toString(16).padStart(40, 'abcdef')}`;
}

/** Sinh tx_hash giả — đúng format 0x + 64 hex chars */
function fakeTxHash(index: number): string {
  return `0x${index.toString(16).padStart(64, '0')}`;
}

/** Random số trong khoảng [min, max] */
function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Random phần tử từ mảng */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Seed Functions ───────────────────────────────────────────────────────────

async function seedUsers(count = 10): Promise<User[]> {
  const repo = AppDataSource.getRepository(User);
  const users: User[] = [];

  for (let i = 0; i < count; i++) {
    const u = repo.create({
      wallet_address: fakeWallet(i + 1),
      username: `artist_${i + 1}`,
      email: `artist${i + 1}@artcurve.io`,
      bio: `Seed user #${i + 1} — Web3 artist`,
      is_verified: i < 3, // 3 verified artists
      role: i === 0 ? 'admin' : 'user',
    });
    users.push(u);
  }

  const saved = await repo.save(users);
  console.log(`✅ Seeded ${saved.length} users`);
  return saved;
}

async function seedArtworks(users: User[], count = 5): Promise<Artwork[]> {
  const repo = AppDataSource.getRepository(Artwork);
  const artworks: Artwork[] = [];

  const statuses = [
    ArtworkStatus.ACTIVE,
    ArtworkStatus.ACTIVE,
    ArtworkStatus.ACTIVE,
    ArtworkStatus.TARGET_REACHED,
    ArtworkStatus.GRADUATED,
  ];

  for (let i = 0; i < count; i++) {
    const targetCap = rand(100, 1000).toFixed(8);
    const currentSupply = rand(10, parseFloat(targetCap) * 0.9).toFixed(8);
    const currentPrice = (parseFloat(currentSupply) / parseFloat(targetCap) + 0.001).toFixed(8);

    const a = repo.create({
      creator_id: pick(users).id,
      contract_address: i < 4 ? null : fakeWallet(1000 + i), // GRADUATED có contract
      title: `Artwork #${i + 1} — ${['Genesis', 'Echo', 'Phantom', 'Aurora', 'Zenith'][i]}`,
      description: `Fractionalized art piece #${i + 1}. 1/${parseInt(targetCap)} shares available.`,
      ipfs_metadata_uri: i >= 2 ? `ipfs://QmFake${i}Hash/metadata.json` : null,
      status: statuses[i],
      target_cap: targetCap,
      current_supply: currentSupply,
      current_price: currentPrice,
      view_count: Math.floor(rand(10, 5000)),
    });
    artworks.push(a);
  }

  const saved = await repo.save(artworks);
  console.log(`✅ Seeded ${saved.length} artworks`);
  return saved;
}

async function seedTransactions(
  users: User[],
  artworks: Artwork[],
  count = 100,
): Promise<void> {
  const txRepo = AppDataSource.getRepository(Transaction);
  const holdingRepo = AppDataSource.getRepository(PortfolioHolding);

  // Track portfolio state để tính avg_buy_price
  const holdingsMap = new Map<string, { balance: number; avgPrice: number }>();

  const txs: Transaction[] = [];

  for (let i = 0; i < count; i++) {
    const user = pick(users);
    const artwork = pick(artworks.filter((a) => a.status === ArtworkStatus.ACTIVE));
    if (!artwork) continue;

    const isBuy = Math.random() > 0.3; // 70% buy, 30% sell
    const shareAmount = rand(0.1, 10).toFixed(8);
    const pricePerShare = rand(0.0001, 0.01).toFixed(8);
    const ethAmount = (parseFloat(shareAmount) * parseFloat(pricePerShare)).toFixed(8);

    const tx = txRepo.create({
      tx_hash: fakeTxHash(i + 1),
      user_id: user.id,
      artwork_id: artwork.id,
      tx_type: isBuy ? TransactionType.BUY : TransactionType.SELL,
      share_amount: shareAmount,
      eth_amount: ethAmount,
      price_per_share: pricePerShare,
      gas_fee: rand(0.00001, 0.0005).toFixed(8),
      block_number: String(Math.floor(rand(18000000, 20000000))),
      timestamp: new Date(Date.now() - Math.floor(rand(0, 30 * 24 * 60 * 60 * 1000))),
    });
    txs.push(tx);

    // Cập nhật holdings map để upsert sau
    const key = `${user.id}_${artwork.id}`;
    const existing = holdingsMap.get(key) ?? { balance: 0, avgPrice: 0 };
    if (isBuy) {
      const newBalance = existing.balance + parseFloat(shareAmount);
      const newAvg =
        (existing.avgPrice * existing.balance +
          parseFloat(pricePerShare) * parseFloat(shareAmount)) /
        newBalance;
      holdingsMap.set(key, { balance: newBalance, avgPrice: newAvg });
    } else {
      const newBalance = Math.max(0, existing.balance - parseFloat(shareAmount));
      holdingsMap.set(key, { balance: newBalance, avgPrice: existing.avgPrice });
    }
  }

  // Batch insert transactions — nhanh hơn single insert
  await txRepo.save(txs, { chunk: 50 });
  console.log(`✅ Seeded ${txs.length} transactions`);

  // Upsert portfolio holdings
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();

  for (const [key, { balance, avgPrice }] of holdingsMap.entries()) {
    const [userId, artworkId] = key.split('_');
    await qr.query(
      `INSERT INTO portfolio_holdings (user_id, artwork_id, share_balance, avg_buy_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, artwork_id) DO UPDATE
         SET share_balance = EXCLUDED.share_balance,
             avg_buy_price = EXCLUDED.avg_buy_price,
             updated_at    = now()`,
      [userId, artworkId, balance.toFixed(8), avgPrice.toFixed(8)],
    );
  }

  await qr.release();
  console.log(`✅ Upserted ${holdingsMap.size} portfolio holdings`);
}

async function seedFollowers(users: User[]): Promise<void> {
  const repo = AppDataSource.getRepository(Follower);
  const followers: Follower[] = [];

  // Mỗi user follow 3 người ngẫu nhiên
  for (const user of users) {
    const targets = users
      .filter((u) => u.id !== user.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    for (const target of targets) {
      followers.push(
        repo.create({ follower_id: user.id, following_id: target.id }),
      );
    }
  }

  // Dùng ON CONFLICT DO NOTHING để tránh duplicate nếu chạy seed 2 lần
  await AppDataSource.query(
    `INSERT INTO followers (follower_id, following_id)
     SELECT unnest($1::uuid[]), unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [
      followers.map((f) => f.follower_id),
      followers.map((f) => f.following_id),
    ],
  );

  console.log(`✅ Seeded ~${followers.length} follow relationships`);
}

async function seedSocialInteractions(
  users: User[],
  artworks: Artwork[],
): Promise<void> {
  const repo = AppDataSource.getRepository(SocialInteraction);
  const interactions: SocialInteraction[] = [];

  for (const artwork of artworks) {
    // 5 likes per artwork
    const likers = users.sort(() => Math.random() - 0.5).slice(0, 5);
    for (const user of likers) {
      interactions.push(
        repo.create({
          user_id: user.id,
          artwork_id: artwork.id,
          interaction_type: InteractionType.LIKE,
        }),
      );
    }

    // 3 comments per artwork
    const commenters = users.sort(() => Math.random() - 0.5).slice(0, 3);
    for (const user of commenters) {
      interactions.push(
        repo.create({
          user_id: user.id,
          artwork_id: artwork.id,
          interaction_type: InteractionType.COMMENT,
          content: `Amazing artwork! I bought ${rand(1, 10).toFixed(2)} shares 🔥`,
        }),
      );
    }
  }

  await repo.save(interactions, { chunk: 50 });
  console.log(`✅ Seeded ${interactions.length} social interactions`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Initializing DataSource...');
  await AppDataSource.initialize();
  console.log('✅ Connected to PostgreSQL\n');

  try {
    // Clean slate — truncate theo thứ tự FK ngược (leaf → root)
    console.log('🧹 Cleaning old seed data...');
    await AppDataSource.query(`TRUNCATE TABLE
      moderation_logs,
      social_interactions,
      followers,
      portfolio_holdings,
      transactions,
      artworks,
      users
    RESTART IDENTITY CASCADE`);
    console.log('✅ Tables cleared\n');

    // Thứ tự quan trọng — FK dependency
    const users = await seedUsers(10);
    const artworks = await seedArtworks(users, 5);
    await seedTransactions(users, artworks, 100);
    await seedFollowers(users);
    await seedSocialInteractions(users, artworks);

    console.log('\n🎉 Seed hoàn tất!');
    console.log('   → Mở DBeaver/pgAdmin kiểm tra 7 bảng và FK constraints');
  } catch (err) {
    console.error('❌ Seed thất bại:', err.message);
    console.error(err.stack);
  } finally {
    await AppDataSource.destroy();
  }
}

main();
