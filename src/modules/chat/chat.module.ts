import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { EscalationTicket } from './entities/escalation-ticket.entity';
import { ChatService } from './chat.service';
import { GeminiService } from './gemini.service';
import { EscalationService } from './escalation.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, ChatMessage, EscalationTicket]),
    HttpModule,
  ],
  providers: [ChatService, GeminiService, EscalationService, ChatGateway],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
