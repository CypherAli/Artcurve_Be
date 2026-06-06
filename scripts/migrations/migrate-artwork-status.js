"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const data_source_1 = require("../../src/database/data-source");
async function main() {
    const ds = new typeorm_1.DataSource(data_source_1.dataSourceOptions);
    await ds.initialize();
    console.log('🔌 Connected to DB');
    const activated = await ds.query(`
    UPDATE artworks
    SET status = 'ACTIVE', updated_at = NOW()
    WHERE status = 'DRAFT'
      AND contract_address IS NOT NULL
    RETURNING id, title
  `);
    console.log(`✅ Activated ${activated.length} artworks with contracts`);
    await ds.destroy();
    console.log('✅ Done');
}
main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
//# sourceMappingURL=migrate-artwork-status.js.map