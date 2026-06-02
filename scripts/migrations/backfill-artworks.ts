/**
 * scripts/migrations/backfill-artworks.ts
 *
 * Backfill script: generate tickers for artworks that have ticker = NULL.
 * Run once after migration 007 (AddArtworkMetaColumns).
 *
 * Usage:
 *   npx ts-node scripts/migrations/backfill-artworks.ts
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { dataSourceOptions } from '../../src/database/data-source'

async function main() {
  const ds = new DataSource(dataSourceOptions)
  await ds.initialize()
  console.log('🔌 Connected to DB')

  const result = await ds.query(`
    UPDATE artworks
    SET ticker = '$' || UPPER(SUBSTRING(REPLACE(title, ' ', ''), 1, 6))
    WHERE ticker IS NULL
    RETURNING id, title, ticker
  `)

  console.log(`✅ Backfilled ${result.length} artworks:`)
  result.forEach((r: { id: string; title: string; ticker: string }) => {
    console.log(`  [${r.id}] "${r.title}" → ${r.ticker}`)
  })

  await ds.destroy()
  console.log('✅ Done')
}

main().catch(err => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
