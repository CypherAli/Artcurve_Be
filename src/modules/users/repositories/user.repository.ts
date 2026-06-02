import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { User } from '../entities/user.entity'

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  findById(id: string)                { return this.repo.findOne({ where: { id } }) }
  findByWallet(walletAddress: string) { return this.repo.findOne({ where: { wallet_address: walletAddress } }) }
  save(user: Partial<User>)           { return this.repo.save(user) }
  findTopCreators(limit: number)      { return this.repo.find({ order: { created_at: 'DESC' }, take: limit }) }
}
