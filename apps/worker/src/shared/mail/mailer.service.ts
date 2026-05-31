import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Thin nodemailer wrapper around the SMTP server configured via env
 * (`MAIL_HOST` / `MAIL_PORT` / `MAIL_FROM`). In dev these point at the Maildev
 * catcher (host `maildev`, port 1025) wired in `infra/docker-compose.yml`.
 *
 * The transport is created lazily and reused, so a single pooled connection
 * serves every job the worker processes.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  private get from(): string {
    return process.env.MAIL_FROM ?? 'Pilotage scolaire <no-reply@pilotage.local>';
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = process.env.MAIL_HOST ?? 'localhost';
    const port = Number(process.env.MAIL_PORT ?? 1025);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      // Maildev (and most local catchers) speak plain SMTP with no auth/TLS.
      secure: false,
      ignoreTLS: true,
    });
    this.logger.log(`SMTP transport ready → ${host}:${port}`);
    return this.transporter;
  }

  async send(msg: MailMessage): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}
