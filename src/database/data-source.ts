import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { User }               from '../modules/users/entities/user.entity';
import { UserWallet }         from '../modules/users/entities/user-wallet.entity';
import { Artwork }            from '../modules/artworks/entities/artwork.entity';
import { Transaction }        from '../modules/trades/entities/transaction.entity';
import { PortfolioHolding }   from '../modules/portfolio/entities/portfolio-holding.entity';
import { Follower }           from '../modules/social/entities/follower.entity';
import { SocialInteraction }  from '../modules/social/entities/social-interaction.entity';
import { ModerationLog }      from '../modules/artworks/entities/moderation-log.entity';
import { LiveStream }         from '../modules/live/entities/live-stream.entity';
import { Notification }      from '../modules/notifications/entities/notification.entity';
import { ChatSession }       from '../modules/chat/entities/chat-session.entity';
import { ChatMessage }       from '../modules/chat/entities/chat-message.entity';
import { EscalationTicket }  from '../modules/chat/entities/escalation-ticket.entity';
import { Guild }             from '../modules/guild/entities/guild.entity';
import { GuildMember }       from '../modules/guild/entities/guild-member.entity';
import { GuildMessage }      from '../modules/guild/entities/guild-message.entity';

const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl  = process.env.DATABASE_URL;

const connectionConfig = databaseUrl
  ? { url: databaseUrl }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME     || 'artcurve_db',
    };

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  ...connectionConfig,

  ssl: isProduction
    ? { rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'true') === 'true' }
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
  ],

  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,

  extra: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  },

  logging: isProduction ? ['error'] : ['query', 'error'],
};

// TypeORM CLI yêu cầu đúng 1 export DataSource duy nhất
const AppDataSource = new DataSource(dataSourceOptions);
export default AppDataSource;
