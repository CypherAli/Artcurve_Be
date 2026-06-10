import { Module }         from '@nestjs/common';
import { TypeOrmModule }  from '@nestjs/typeorm';
import { User }           from './entities/user.entity';
import { UserWallet }     from './entities/user-wallet.entity';
import { UsersService }   from './users.service';
import { UsersController } from './users.controller';
import { UserRepository } from './repositories/user.repository';

@Module({
  imports:     [TypeOrmModule.forFeature([User, UserWallet])],
  controllers: [UsersController],
  providers:   [UsersService, UserRepository],
  exports:     [UsersService, UserRepository],   // auth module có thể dùng
})
export class UsersModule {}
