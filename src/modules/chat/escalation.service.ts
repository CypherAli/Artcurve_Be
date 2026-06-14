import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as nodemailer from 'nodemailer';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationTicket } from './entities/escalation-ticket.entity';

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly notifSvc: NotificationsService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    const smtpHost = this.config.get<string>('SMTP_HOST', '');
    if (smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: false,
        auth: {
          user: this.config.get<string>('SMTP_USER', ''),
          pass: this.config.get<string>('SMTP_PASS', ''),
        },
      });
    }
  }

  async escalate(
    ticket: EscalationTicket,
    transcript: { sender: string; content: string; created_at: Date }[],
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.sendInAppNotification(ticket),
      this.sendEmail(ticket, transcript),
      this.sendTelegram(ticket),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(`Escalation channel failed: ${r.reason}`);
      }
    }
  }

  private async sendInAppNotification(ticket: EscalationTicket): Promise<void> {
    await this.notifSvc.create({
      user_id: ticket.user_id,
      type: 'escalation' as any,
      title: 'Support ticket created',
      description: `Your chat has been escalated to our support team. Ticket #${ticket.id.slice(0, 8)}`,
      metadata: { ticket_id: ticket.id, session_id: ticket.session_id },
    });
    this.logger.log(`In-app notification sent for ticket ${ticket.id}`);
  }

  private async sendEmail(
    ticket: EscalationTicket,
    transcript: { sender: string; content: string; created_at: Date }[],
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.warn('SMTP not configured — skipping email escalation');
      return;
    }

    const escalationEmail = this.config.get<string>('ESCALATION_EMAIL', '');
    if (!escalationEmail) return;

    const chatLog = transcript
      .slice(-20)
      .map(
        (m) =>
          `[${m.sender.toUpperCase()}] ${m.content.slice(0, 200)}`,
      )
      .join('\n');

    await this.transporter.sendMail({
      from: this.config.get<string>('SMTP_USER', 'noreply@artcurve.io'),
      to: escalationEmail,
      subject: `[ArtCurve Support] Escalation Ticket #${ticket.id.slice(0, 8)}`,
      html: `
        <h2>Chat Escalation</h2>
        <p><strong>Ticket ID:</strong> ${ticket.id}</p>
        <p><strong>User ID:</strong> ${ticket.user_id}</p>
        <p><strong>Priority:</strong> ${ticket.priority}</p>
        <p><strong>Summary:</strong> ${ticket.summary}</p>
        <h3>Recent Chat Transcript</h3>
        <pre>${chatLog}</pre>
      `,
    });
    this.logger.log(`Email sent to ${escalationEmail} for ticket ${ticket.id}`);
  }

  private async sendTelegram(ticket: EscalationTicket): Promise<void> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    const chatId = this.config.get<string>('TELEGRAM_ESCALATION_CHAT_ID', '');
    if (!botToken || !chatId) {
      this.logger.warn('Telegram not configured — skipping');
      return;
    }

    const text =
      `🎫 *ArtCurve Support Escalation*\n\n` +
      `*Ticket:* \`${ticket.id.slice(0, 8)}\`\n` +
      `*Priority:* ${ticket.priority}\n` +
      `*Summary:* ${ticket.summary.slice(0, 200)}`;

    try {
      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          { chat_id: chatId, text, parse_mode: 'Markdown' },
        ),
      );
      this.logger.log(`Telegram message sent for ticket ${ticket.id}`);
    } catch (err: any) {
      this.logger.warn(`Telegram send failed: ${err.message}`);
    }
  }
}
