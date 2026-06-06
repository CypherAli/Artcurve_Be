"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const data_source_1 = require("../src/database/data-source");
async function main() {
    const ds = new typeorm_1.DataSource(data_source_1.dataSourceOptions);
    await ds.initialize();
    console.log('🔌 Connected to DB');
    await ds.query(`
    INSERT INTO users (id, wallet_address, username, role, bio, is_verified, created_at, updated_at)
    VALUES
      ('a1000000-0000-0000-0000-000000000001','0x1111111111111111111111111111111111111111','elena_v','user','Contemporary digital artist.',true,NOW(),NOW()),
      ('a1000000-0000-0000-0000-000000000002','0x2222222222222222222222222222222222222222','marcus_ch','user','Generative art pioneer.',false,NOW(),NOW()),
      ('a1000000-0000-0000-0000-000000000003','0x3333333333333333333333333333333333333333','aiko_t','user','Neo-surrealist illustrator.',true,NOW(),NOW()),
      ('a1000000-0000-0000-0000-000000000004','0x4444444444444444444444444444444444444444','collector1','user',NULL,false,NOW(),NOW())
    ON CONFLICT (wallet_address) DO NOTHING
  `);
    console.log('✅ 4 users seeded');
    const artworks = [
        {
            id: 'b1000000-0000-0000-0000-000000000001',
            creator: 'a1000000-0000-0000-0000-000000000001',
            title: 'Solitude in the Digital Rain',
            desc: 'A meditation on loneliness in hyper-connected worlds.',
            ticker: '$SOLRA', status: 'ACTIVE',
            price: 0.00042, supply: 12000, target: 24,
            curve: 'linear', init: 0.0001, royalty: 5.00,
            category: 'Digital Painting', views: 847, daysAgo: 5,
        },
        {
            id: 'b1000000-0000-0000-0000-000000000002',
            creator: 'a1000000-0000-0000-0000-000000000002',
            title: 'Genesis Protocol #7',
            desc: 'From pure mathematics, beauty emerges.',
            ticker: '$GENP7', status: 'ACTIVE',
            price: 0.00089, supply: 8500, target: 24,
            curve: 'exponential', init: 0.00005, royalty: 3.50,
            category: 'Generative Art', views: 1203, daysAgo: 10,
        },
        {
            id: 'b1000000-0000-0000-0000-000000000003',
            creator: 'a1000000-0000-0000-0000-000000000003',
            title: 'Sakura Overload',
            desc: 'When cherry blossoms meet synthwave.',
            ticker: '$SAKOL', status: 'ACTIVE',
            price: 0.00156, supply: 5200, target: 24,
            curve: 'quadratic', init: 0.0002, royalty: 7.00,
            category: 'Illustration', views: 2891, daysAgo: 3,
        },
        {
            id: 'b1000000-0000-0000-0000-000000000004',
            creator: 'a1000000-0000-0000-0000-000000000001',
            title: 'The Last Algorithm',
            desc: 'What if AI dreamed of its own obsolescence?',
            ticker: '$TLALG', status: 'ACTIVE',
            price: 0.00023, supply: 18000, target: 24,
            curve: 'linear', init: 0.00008, royalty: 4.00,
            category: 'Concept Art', views: 412, daysAgo: 1,
        },
        {
            id: 'b1000000-0000-0000-0000-000000000005',
            creator: 'a1000000-0000-0000-0000-000000000002',
            title: 'Entropy Garden',
            desc: 'Order dissolving into chaos, captured at phase transition.',
            ticker: '$ENTGD', status: 'ACTIVE',
            price: 0.00311, supply: 3100, target: 24,
            curve: 'exponential', init: 0.0003, royalty: 6.50,
            category: 'Abstract', views: 1567, daysAgo: 7,
        },
        {
            id: 'b1000000-0000-0000-0000-000000000006',
            creator: 'a1000000-0000-0000-0000-000000000003',
            title: 'Neon Torii',
            desc: 'Ancient gates reborn in neon light.',
            ticker: '$NEOTR', status: 'DRAFT',
            price: 0.0001, supply: 0, target: 24,
            curve: 'linear', init: 0.0001, royalty: 5.00,
            category: 'Photography', views: 89, daysAgo: 0,
        },
    ];
    for (const a of artworks) {
        const createdAt = a.daysAgo > 0
            ? `NOW() - INTERVAL '${a.daysAgo} days'`
            : 'NOW()';
        await ds.query(`
      INSERT INTO artworks (
        id, creator_id, title, description, ticker,
        ipfs_metadata_uri, status,
        current_price, current_supply, target_cap,
        curve_type, init_price, royalty_pct,
        category, view_count, created_at, updated_at
      ) VALUES (
        '${a.id}', '${a.creator}', '${a.title}', '${a.desc}', '${a.ticker}',
        'ipfs://QmPlaceholder', '${a.status}',
        ${a.price}, ${a.supply}, ${a.target},
        '${a.curve}', ${a.init}, ${a.royalty},
        '${a.category}', ${a.views}, ${createdAt}, NOW()
      ) ON CONFLICT (id) DO NOTHING
    `);
        console.log(`  ✓ ${a.title}`);
    }
    console.log('✅ 6 artworks seeded');
    await ds.query(`
    INSERT INTO portfolio_holdings (id, user_id, artwork_id, share_balance, avg_buy_price, created_at, updated_at)
    VALUES
      ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001',500,0.00035,NOW(),NOW()),
      ('c1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000003',200,0.00120,NOW(),NOW())
    ON CONFLICT (user_id, artwork_id) DO NOTHING
  `);
    console.log('✅ 2 portfolio holdings seeded');
    await ds.destroy();
    console.log('\n🎉 Seed complete — DB ready for development!');
}
main().catch(err => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map