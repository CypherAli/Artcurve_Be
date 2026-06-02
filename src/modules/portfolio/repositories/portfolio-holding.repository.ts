import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { PortfolioHolding } from '../entities/portfolio-holding.entity'

@Injectable()
export class PortfolioHoldingRepository {
  constructor(
    @InjectRepository(PortfolioHolding)
    private readonly repo: Repository<PortfolioHolding>,
  ) {}

  findByUser(userId: string)                           { return this.repo.find({ where: { user_id: userId } }) }
  findByArtwork(artworkId: string)                     { return this.repo.find({ where: { artwork_id: artworkId }, order: { share_balance: 'DESC' } }) }
  findOne(userId: string, artworkId: string)           { return this.repo.findOne({ where: { user_id: userId, artwork_id: artworkId } }) }
  save(holding: Partial<PortfolioHolding>)             { return this.repo.save(holding) }
}
