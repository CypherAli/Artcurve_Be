import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env từ root project
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Import từng entity từ vị trí mới trong các module
import { User } from '../modules/users/entities/user.entity';
import { Artwork } from '../modules/artworks/entities/artwork.entity';
import { Transaction } from '../modules/trades/entities/transaction.entity';
import { PortfolioHolding } from '../modules/portfolio/entities/portfolio-holding.entity';
import { Follower } from '../modules/social/entities/follower.entity';
import { SocialInteraction } from '../modules/social/entities/social-interaction.entity';
import { ModerationLog } from '../modules/artworks/entities/moderation-log.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'artcurve_db',

  ssl: process.env.NODE_ENV === 'production'
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

  extra: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  },

  logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
};

// TypeORM CLI yêu cầu đúng 1 export DataSource duy nhất
const AppDataSource = new DataSource(dataSourceOptions);
export default AppDataSource;
