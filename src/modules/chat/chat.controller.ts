import {
  Controller, Get, Post, Patch,
  Body, Param, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { CurrentUser } from '../auth/decorators';
import type { JwtPayload } from '../auth/auth.service';
import { SendMessageDto } from './dto/send-message.dto';
import { EscalateDto } from './dto/escalate.dto';

@ApiTags('Chat')
@ApiBearerAuth('JWT-auth')
@Controller('chat')
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message and get AI response' })
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    const result = await this.svc.sendMessage(user.sub, dto);
    return {
      session_id: result.userMsg.session_id,
      user_message: result.userMsg,
      ai_message: result.aiMsg,
      should_escalate: result.shouldEscalate,
    };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List user chat sessions' })
  async listSessions(@CurrentUser() user: JwtPayload) {
    return this.svc.getSessions(user.sub);
  }

  @Get('sessions/:id/messages')
  @ApiOperation({ summary: 'Get chat history for a session' })
  async getHistory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(parseInt(limit ?? '50', 10) || 50, 100);
    const off = parseInt(offset ?? '0', 10) || 0;
    return this.svc.getHistory(id, user.sub, lim, off);
  }

  @Post('sessions/:id/escalate')
  @ApiOperation({ summary: 'Escalate chat session to human support' })
  async escalate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: EscalateDto,
  ) {
    return this.svc.escalate(user.sub, id, dto.reason);
  }

  @Patch('sessions/:id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close a chat session' })
  async closeSession(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.svc.closeSession(id, user.sub);
  }
}
