import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ArtworksModule } from '../artworks/artworks.module';
import { VaultModule } from '../vault/vault.module';
import { GuildModule } from '../guild/guild.module';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { EscalationTicket } from './entities/escalation-ticket.entity';
import { ChatService } from './chat.service';
import { GeminiService } from './gemini.service';
import { ChatToolsService } from './chat-tools.service';
import { EscalationService } from './escalation.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage, EscalationTicket]),
    HttpModule,
    AuthModule,
    NotificationsModule,
    ArtworksModule,
    VaultModule,
    GuildModule,
  ],
  providers: [ChatService, GeminiService, ChatToolsService, EscalationService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
