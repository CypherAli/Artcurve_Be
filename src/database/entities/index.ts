// Backwards-compatibility barrel — re-exports from module-owned entity files.
// Do NOT import from the old ./user.entity paths — they are kept only for migrations.
export { User, UserRole } from '../../modules/users/entities/user.entity';
export { Artwork, ArtworkStatus, CurveType, ARTWORK_CATEGORIES } from '../../modules/artworks/entities/artwork.entity';
export { Transaction, TransactionType } from '../../modules/trades/entities/transaction.entity';
export { PortfolioHolding } from '../../modules/portfolio/entities/portfolio-holding.entity';
export { Follower } from '../../modules/social/entities/follower.entity';
export { SocialInteraction, InteractionType } from '../../modules/social/entities/social-interaction.entity';
export { ModerationLog, ModerationAction } from '../../modules/artworks/entities/moderation-log.entity';
