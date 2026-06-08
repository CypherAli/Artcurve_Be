import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Transaction } from '../entities/transaction.entity'

@Injectable()
export class TransactionRepository {
  constructor(
    @InjectRepository(Transaction)
    private readonly repo: Repository<Transaction>,
  ) {}

  findByArtwork(artworkId: string, skip = 0, take = 20) {
    return this.repo.findAndCount({ where: { artwork_id: artworkId }, skip, take, order: { timestamp: 'DESC' } })
  }

  findRecent(take = 20) {
    return this.repo
      .createQueryBuilder('tx')
      .leftJoin('tx.user',    'user')
      .leftJoin('tx.artwork', 'artwork')
      .select([
        'tx.id', 'tx.tx_type', 'tx.share_amount', 'tx.eth_amount',
        'tx.price_per_share', 'tx.timestamp',
        'user.wallet_address', 'user.username', 'user.avatar_url',
        'artwork.id', 'artwork.title', 'artwork.ticker', 'artwork.image_uri', 'artwork.ipfs_metadata_uri',
      ])
      .orderBy('tx.timestamp', 'DESC')
      .limit(take)
      .getMany()
  }

  save(tx: Partial<Transaction>) { return this.repo.save(tx) }
}
