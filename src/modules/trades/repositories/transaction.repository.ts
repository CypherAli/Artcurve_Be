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
  save(tx: Partial<Transaction>) { return this.repo.save(tx) }
}
