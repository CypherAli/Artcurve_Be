import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User }              from '../modules/users/entities/user.entity';
import { Artwork }           from '../modules/artworks/entities/artwork.entity';
import { Transaction }       from '../modules/trades/entities/transaction.entity';
import { PortfolioHolding }  from '../modules/portfolio/entities/portfolio-holding.entity';
import { Follower }          from '../modules/social/entities/follower.entity';
import { SocialInteraction } from '../modules/social/entities/social-interaction.entity';
import { ModerationLog }     from '../modules/artworks/entities/moderation-log.entity';
import { LiveStream }        from '../modules/live/entities/live-stream.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const databaseUrl  = config.get<string>('DATABASE_URL');
        const isProduction = config.get('NODE_ENV') === 'production';

        const connectionConfig = databaseUrl
          ? { url: databaseUrl }
          : {
              host:     config.get<string>('DB_HOST',     'localhost'),
              port:     config.get<number>('DB_PORT',     5432),
              username: config.get<string>('DB_USERNAME', 'postgres'),
              password: config.get<string>('DB_PASSWORD', 'postgres'),
              database: config.get<string>('DB_NAME',     'artcurve_db'),
            };

        return {
          type: 'postgres' as const,
          ...connectionConfig,

          ssl: isProduction ? { rejectUnauthorized: false } : false,

          entities: [
            User,
            Artwork,
            Transaction,
            PortfolioHolding,
            Follower,
            SocialInteraction,
            ModerationLog,
            LiveStream,
          ],

          migrations: [__dirname + '/migrations/*{.ts,.js}'],
          synchronize:    false,
          migrationsRun:  true,   // chạy pending migrations tự động khi app start

          extra: {
            max: config.get<number>('DB_POOL_MAX', 20),
            min: config.get<number>('DB_POOL_MIN', 2),
            idleTimeoutMillis:     30000,
            connectionTimeoutMillis: 10000,
            statement_timeout:     30000,
          },

          logging: isProduction ? ['error'] : ['query', 'error'],
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
