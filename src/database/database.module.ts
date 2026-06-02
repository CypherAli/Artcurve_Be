import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from '../modules/users/entities/user.entity';
import { Artwork } from '../modules/artworks/entities/artwork.entity';
import { Transaction } from '../modules/trades/entities/transaction.entity';
import { PortfolioHolding } from '../modules/portfolio/entities/portfolio-holding.entity';
import { Follower } from '../modules/social/entities/follower.entity';
import { SocialInteraction } from '../modules/social/entities/social-interaction.entity';
import { ModerationLog } from '../modules/artworks/entities/moderation-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'artcurve_db'),

        ssl: config.get('NODE_ENV') === 'production'
          ? { rejectUnauthorized: false }
          : false,

        entities: [
          User,
          Artwork,
          Transaction,
          PortfolioHolding,
          Follower,
          SocialInteraction,
          ModerationLog,
        ],

        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,

        // Pool: production grade — NestJS microservice có thể spawn nhiều worker
        extra: {
          max: config.get<number>('DB_POOL_MAX', 20),
          min: config.get<number>('DB_POOL_MIN', 2),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
          statement_timeout: 30000,
        },

        logging: config.get('NODE_ENV') === 'development'
          ? ['query', 'error']
          : ['error'],
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
