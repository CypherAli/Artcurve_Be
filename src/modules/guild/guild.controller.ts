import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { GuildService } from './guild.service';
import { CreateGuildDto } from './dto/create-guild.dto';
import { UpdateGuildDto } from './dto/update-guild.dto';
import { CreateGuildMessageDto } from './dto/guild-message.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CurrentUser, Public } from '../../common/decorators';
import { JwtPayload } from '../auth/auth.service';
import { GuildRole } from './entities/guild-member.entity';

@ApiTags('guilds')
@Controller('guilds')
export class GuildController {
  constructor(
    private readonly guildService: GuildService,
    private readonly configService: ConfigService,
  ) {}

  // ── Create guild ──────────────────────────────────────────────────────────

  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new guild' })
  create(@Body() dto: CreateGuildDto, @CurrentUser() user: JwtPayload) {
    return this.guildService.createGuild(user.sub, user.wallet, dto);
  }

  // ── Join by invite (must be before :id routes) ────────────────────────────

  @Post('join-by-invite')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Join guild via invite code' })
  joinByInvite(
    @Body('code') code: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.useInvite(code, user.sub);
  }

  // ── List all guilds ───────────────────────────────────────────────────────

  @Get()
  @Public()
  @ApiOperation({ summary: 'List all guilds (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.listGuilds(page ? +page : 1, limit ? +limit : 20);
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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.guildService.getGuild(id);
  }

  // ── Update guild settings ─────────────────────────────────────────────────

  @Patch(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update guild settings (owner only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuildDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.updateGuild(id, user.sub, dto);
  }

  // ── Delete guild ──────────────────────────────────────────────────────────

  @Delete(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete guild (owner only)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteGuild(id, user.sub);
  }

  // ── Join guild ────────────────────────────────────────────────────────────

  @Post(':id/join')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Join a guild' })
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.joinGuild(id, user.sub);
  }

  // ── Leave guild ───────────────────────────────────────────────────────────

  @Delete(':id/leave')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Leave a guild' })
  leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.guildService.leaveGuild(id, user.sub);
  }

  // ── Members ───────────────────────────────────────────────────────────────

  @Get(':id/members')
  @Public()
  @ApiOperation({ summary: 'List guild members (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  members(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.getMembers(id, page ? +page : 1, limit ? +limit : 30);
  }

  // ── Kick member ───────────────────────────────────────────────────────────

  @Delete(':id/members/:userId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Kick a member (owner/moderator)' })
  kick(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.kickMember(id, user.sub, userId);
  }

  // ── Change member role ────────────────────────────────────────────────────

  @Patch(':id/members/:userId/role')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change member role (owner only)' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body('role') role: GuildRole,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.changeMemberRole(id, user.sub, userId, role);
  }

  // ── Transfer ownership ────────────────────────────────────────────────────

  @Post(':id/transfer')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Transfer guild ownership (owner only)' })
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('userId') newOwnerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.transferOwnership(id, user.sub, newOwnerId);
  }

  // ── Post message ──────────────────────────────────────────────────────────

  @Post(':id/messages')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Post a message to guild chat' })
  postMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuildMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.postMessage(id, user.sub, user.wallet, dto.content);
  }

  // ── Delete message ────────────────────────────────────────────────────────

  @Delete(':id/messages/:messageId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a message (author/moderator/owner)' })
  deleteMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteMessage(id, messageId, user.sub);
  }

  // ── Get messages ──────────────────────────────────────────────────────────

  @Get(':id/messages')
  @Public()
  @ApiOperation({ summary: 'Get guild messages (cursor-based)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String, description: 'ISO date cursor' })
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    return this.guildService.getMessages(id, limit ? +limit : 50, before);
  }

  // ── Collective holdings ───────────────────────────────────────────────────

  @Get(':id/holdings')
  @Public()
  @ApiOperation({ summary: 'Aggregated portfolio holdings of all guild members' })
  holdings(@Param('id', ParseUUIDPipe) id: string) {
    return this.guildService.getHoldings(id);
  }

  // ── Announcements ─────────────────────────────────────────────────────────

  @Post(':id/announcements')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create announcement (owner/moderator)' })
  createAnnouncement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.createAnnouncement(id, user.sub, user.wallet, dto.title, dto.content);
  }

  @Get(':id/announcements')
  @Public()
  @ApiOperation({ summary: 'Get guild announcements' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getAnnouncements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.getAnnouncements(id, limit ? +limit : 10);
  }

  @Delete(':id/announcements/:announcementId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete announcement' })
  deleteAnnouncement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteAnnouncement(id, announcementId, user.sub);
  }

  @Patch(':id/announcements/:announcementId/pin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Toggle pin announcement' })
  togglePin(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.togglePin(id, announcementId, user.sub);
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  @Post(':id/invites')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create invite link (owner/moderator)' })
  createInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.createInvite(id, user.sub, dto.max_uses, dto.expires_in_hours);
  }

  @Get(':id/invites')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List guild invites (owner/moderator)' })
  getInvites(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.getInvites(id, user.sub);
  }

  @Delete(':id/invites/:inviteId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete invite' })
  deleteInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.guildService.deleteInvite(id, inviteId, user.sub);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  @Get(':id/analytics')
  @Public()
  @ApiOperation({ summary: 'Guild trading analytics' })
  analytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.guildService.getAnalytics(id);
  }

  // ── Activity Feed ─────────────────────────────────────────────────────────

  @Get(':id/activity')
  @Public()
  @ApiOperation({ summary: 'Recent trading activity of guild members' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  activity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: number,
  ) {
    return this.guildService.getActivity(id, limit ? +limit : 20);
  }

  // ── AI character prompt generation (proxies Gemini API) ────────────────────

  @Post('ai/character-prompt')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Generate character description via Gemini (server-side key)' })
  async generateCharacterPrompt(
    @Body('prompt') prompt: string,
  ) {
    if (!prompt || prompt.length > 500)
      throw new BadRequestException('Prompt must be 1-500 chars');

    const key = this.configService.get<string>('GEMINI_API_KEY');
    if (!key) throw new BadRequestException('AI generation not configured');

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Generate a detailed character description as a 3D Pixar-style illustration prompt for an art guild member. The character should be a cute anthropomorphic cat in a fantasy guild setting. User's description: "${prompt}". Return ONLY the image generation prompt, nothing else. Make it vivid and detailed, under 300 chars.`,
            }],
          }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
        }),
      },
    );

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    return { text };
  }
}
