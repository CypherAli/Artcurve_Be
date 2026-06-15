import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GuildService } from './guild.service';
import { CreateGuildDto } from './dto/create-guild.dto';
import { CurrentUser, Public } from '../../common/decorators';
import { JwtPayload } from '../auth/auth.service';

@ApiTags('guilds')
@Controller('guilds')
export class GuildController {
  constructor(private readonly guildService: GuildService) {}

  // ── Create guild ──────────────────────────────────────────────────────────

  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new guild' })
  create(@Body() dto: CreateGuildDto, @CurrentUser() user: JwtPayload) {
    return this.guildService.createGuild(user.sub, user.wallet, dto);
  }

  // ── List all guilds ───────────────────────────────────────────────────────

  @Get()
  @Public()
  @ApiOperation({ summary: 'List all guilds' })
  findAll() {
    return this.guildService.listGuilds();
  }

  // ── My guilds ─────────────────────────────────────────────────────────────

  @Get('my')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List guilds the current user belongs to' })
  myGuilds(@CurrentUser() user: JwtPayload) {
    return this.guildService.myGuilds(user.sub);
  }

  // ── Guild detail ──────────────────────────────────────────────────────────

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get guild detail' })
  findOne(@Param('id') id: string) {
    return this.guildService.getGuild(id);
  }

  // ── Join guild ────────────────────────────────────────────────────────────

  @Post(':id/join')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Join a guild' })
  join(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.joinGuild(id, user.sub);
  }

  // ── Leave guild ───────────────────────────────────────────────────────────

  @Delete(':id/leave')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Leave a guild' })
  leave(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.leaveGuild(id, user.sub);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  @Get(':id/members')
  @Public()
  @ApiOperation({ summary: 'List guild members' })
  members(@Param('id') id: string) {
    return this.guildService.getMembers(id);
  }

  // ── Post message ──────────────────────────────────────────────────────────

  @Post(':id/messages')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Post a message to guild chat' })
  postMessage(
    @Param('id') id: string,
    @Body('content') content: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.postMessage(id, user.sub, user.wallet, content);
  }

  // ── Get messages ──────────────────────────────────────────────────────────

  @Get(':id/messages')
  @Public()
  @ApiOperation({ summary: 'Get recent guild messages' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.getMessages(id, limit ? +limit : 50);
  }

  // ── Collective holdings ───────────────────────────────────────────────────

  @Get(':id/holdings')
  @Public()
  @ApiOperation({ summary: 'Aggregated portfolio holdings of all guild members' })
  holdings(@Param('id') id: string) {
    return this.guildService.getHoldings(id);
  }
}
