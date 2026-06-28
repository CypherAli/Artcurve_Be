import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User }              from '../modules/users/entities/user.entity';
import { UserWallet }        from '../modules/users/entities/user-wallet.entity';
import { Artwork }           from '../modules/artworks/entities/artwork.entity';
import { Transaction }       from '../modules/trades/entities/transaction.entity';
import { PortfolioHolding }  from '../modules/portfolio/entities/portfolio-holding.entity';
import { Follower }          from '../modules/social/entities/follower.entity';
import { SocialInteraction } from '../modules/social/entities/social-interaction.entity';
import { ModerationLog }     from '../modules/artworks/entities/moderation-log.entity';
import { LiveStream }        from '../modules/live/entities/live-stream.entity';
import { Notification }     from '../modules/notifications/entities/notification.entity';
import { ChatSession }      from '../modules/chat/entities/chat-session.entity';
import { ChatMessage }      from '../modules/chat/entities/chat-message.entity';
import { EscalationTicket } from '../modules/chat/entities/escalation-ticket.entity';
import { Guild }           from '../modules/guild/entities/guild.entity';
import { GuildMember }     from '../modules/guild/entities/guild-member.entity';
import { GuildMessage }    from '../modules/guild/entities/guild-message.entity';
import { SecurityEvent }  from '../modules/security/entities/security-event.entity';

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

          ssl: isProduction
            ? { rejectUnauthorized: config.get('DB_SSL_REJECT_UNAUTHORIZED', 'true') === 'true' }
            : false,

          entities: [
            User,
            UserWallet,
            Artwork,
            Transaction,
            PortfolioHolding,
            Follower,
            SocialInteraction,
            ModerationLog,
            LiveStream,
            Notification,
            ChatSession,
            ChatMessage,
            EscalationTicket,
            Guild,
            GuildMember,
            GuildMessage,
            SecurityEvent,
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
