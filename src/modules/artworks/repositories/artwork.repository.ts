import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Artwork } from '../entities/artwork.entity'

@Injectable()
export class ArtworkRepository {
  constructor(
    @InjectRepository(Artwork)
    private readonly repo: Repository<Artwork>,
  ) {}

  findById(id: string)              { return this.repo.findOne({ where: { id }, relations: ['creator'] }) }
  findAll(skip = 0, take = 20)     { return this.repo.findAndCount({ skip, take, relations: ['creator'], order: { created_at: 'DESC' } }) }
  findByCreator(creatorId: string)  { return this.repo.find({ where: { creator_id: creatorId }, relations: ['creator'] }) }
  save(artwork: Partial<Artwork>)   { return this.repo.save(artwork) }
}
