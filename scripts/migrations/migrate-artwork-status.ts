/**
 * scripts/migrations/migrate-artwork-status.ts
 *
 * One-time migration: set all artworks with progress >= 100% to TARGET_REACHED
 * and all with contract_address set but status = DRAFT to ACTIVE.
 *
 * Usage:
 *   npx ts-node scripts/migrations/migrate-artwork-status.ts
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { dataSourceOptions } from '../../src/database/data-source'

async function main() {
  const ds = new DataSource(dataSourceOptions)
  await ds.initialize()
  console.log('🔌 Connected to DB')

  // Mark artworks with contract set but still DRAFT → ACTIVE
  const activated = await ds.query(`
    UPDATE artworks
    SET status = 'ACTIVE', updated_at = NOW()
    WHERE status = 'DRAFT'
      AND contract_address IS NOT NULL
    RETURNING id, title
  `)
  console.log(`✅ Activated ${activated.length} artworks with contracts`)

  await ds.destroy()
  console.log('✅ Done')
}

main().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
