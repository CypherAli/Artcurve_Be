"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const data_source_1 = require("../../src/database/data-source");
async function main() {
    const ds = new typeorm_1.DataSource(data_source_1.dataSourceOptions);
    await ds.initialize();
    console.log('🔌 Connected to DB');
    const result = await ds.query(`
    UPDATE artworks
    SET ticker = '$' || UPPER(SUBSTRING(REPLACE(title, ' ', ''), 1, 6))
    WHERE ticker IS NULL
    RETURNING id, title, ticker
  `);
    console.log(`✅ Backfilled ${result.length} artworks:`);
    result.forEach((r) => {
        console.log(`  [${r.id}] "${r.title}" → ${r.ticker}`);
    });
    await ds.destroy();
    console.log('✅ Done');
}
main().catch(err => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
});
//# sourceMappingURL=backfill-artworks.js.map