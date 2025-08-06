import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
  AlertChannelUnion, 
  ChannelType, 
  AlertRule, 
  SmartContractEvent, 
  AlertMessage, 
  SystemAlert,
  AlertSeverity,
  DiscordChannel,
  SlackChannel,
  EmailChannel,
  WebhookChannel,
  SMSChannel,
  TelegramChannel
} from '../../types/monitoring.ts';
import { Webhook } from '../webhook/index.ts';
import { WebhookColor, EmbedField } from '../../types/webhook.ts';

export class AlertService extends EventEmitter {
  private channels: Map<string, AlertChannelUnion> = new Map();
  private alertHistory: AlertMessage[] = [];
  private maxHistorySize: number = 1000;
  private cooldownTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(channels: AlertChannelUnion[]) {
    super();
    
    // Initialize channels
    for (const channel of channels) {
      this.addChannel(channel);
    }
  }

  public addChannel(channel: AlertChannelUnion): void {
    this.channels.set(channel.name, channel);
    console.log(`[ALERT] Added channel: ${channel.name} (${channel.type})`);
  }

  public removeChannel(channelName: string): void {
    this.channels.delete(channelName);
    console.log(`[ALERT] Removed channel: ${channelName}`);
  }

  public async sendAlerts(event: SmartContractEvent, rules: AlertRule[]): Promise<void> {
    try {
      for (const rule of rules) {
        // Check cooldown
        if (this.isInCooldown(rule)) {
          console.log(`[ALERT] Rule ${rule.name} is in cooldown, skipping alert`);
          continue;
        }

        // Create alert message
        const alertMessage: AlertMessage = {
          id: uuidv4(),
          ruleId: rule.id,
          event,
          severity: rule.severity,
          message: this.formatAlertMessage(event, rule),
          timestamp: new Date(),
          channels: rule.channels,
          metadata: { rule }
        };

        // Send to specified channels
        await this.sendToChannels(alertMessage, rule.channels);

        // Add to history
        this.addToHistory(alertMessage);

        // Set cooldown timer
        if (rule.cooldown) {
          this.setCooldown(rule);
        }

        console.log(`[ALERT] Sent alert for rule: ${rule.name}`);
      }
    } catch (error) {
      console.error('[ALERT] Error sending alerts:', error);
      this.emit('error', error);
    }
  }

  public async sendSystemAlert(alert: SystemAlert): Promise<void> {
    try {
      // Send to all enabled channels
      const enabledChannels = Array.from(this.channels.values()).filter(channel => channel.enabled);
      
      for (const channel of enabledChannels) {
        await this.sendToChannel(alert, channel);
      }

      console.log(`[ALERT] Sent system alert: ${alert.type}`);
    } catch (error) {
      console.error('[ALERT] Error sending system alert:', error);
      this.emit('error', error);
    }
  }

  private async sendToChannels(alertMessage: AlertMessage, channelNames: string[]): Promise<void> {
    for (const channelName of channelNames) {
      const channel = this.channels.get(channelName);
      if (channel && channel.enabled) {
        try {
          await this.sendToChannel(alertMessage, channel);
        } catch (error) {
          console.error(`[ALERT] Error sending to channel ${channelName}:`, error);
        }
      }
    }
  }

  private async sendToChannel(alert: AlertMessage | SystemAlert, channel: AlertChannelUnion): Promise<void> {
    try {
      switch (channel.type) {
        case ChannelType.DISCORD:
          await this.sendDiscordAlert(alert, channel);
          break;
        case ChannelType.SLACK:
          await this.sendSlackAlert(alert, channel);
          break;
        case ChannelType.EMAIL:
          await this.sendEmailAlert(alert, channel);
          break;
        case ChannelType.WEBHOOK:
          await this.sendWebhookAlert(alert, channel);
          break;
        case ChannelType.SMS:
          await this.sendSMSAlert(alert, channel);
          break;
        case ChannelType.TELEGRAM:
          await this.sendTelegramAlert(alert, channel);
          break;
        default:
          console.warn(`[ALERT] Unknown channel type: ${channel.type}`);
      }
    } catch (error) {
      console.error(`[ALERT] Error sending to ${channel.type} channel:`, error);
      throw error;
    }
  }

  private async sendDiscordAlert(alert: AlertMessage | SystemAlert, channel: DiscordChannel): Promise<void> {
    const webhook = new Webhook(channel.config.webhookUrl);
    
    const fields: EmbedField[] = this.createDiscordFields(alert);
    
    let title = '';
    let color = WebhookColor.INFO;

    if ('event' in alert) {
      // AlertMessage
      title = `🚨 Alert: ${alert.event.type}`;
      color = this.getDiscordColor(alert.severity);
    } else {
      // SystemAlert
      title = `⚙️ System Alert: ${alert.type}`;
      color = this.getDiscordColor(alert.severity);
    }

    await webhook.sendEmbed({
      title,
      fields,
      color,
      username: channel.config.username,
      avatar_url: channel.config.avatarUrl
    });
  }

  private async sendSlackAlert(alert: AlertMessage | SystemAlert, channel: SlackChannel): Promise<void> {
    const payload = this.createSlackPayload(alert, channel);
    
    const response = await fetch(channel.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }
  }

  private async sendEmailAlert(alert: AlertMessage | SystemAlert, channel: EmailChannel): Promise<void> {
    // This would require an email service like nodemailer
    // For now, we'll log the email content
    const emailContent = this.createEmailContent(alert);
    console.log(`[ALERT] Email to ${channel.config.toEmails.join(', ')}:`, emailContent);
    
    // TODO: Implement actual email sending
    // const transporter = nodemailer.createTransporter({
    //   host: channel.config.smtpHost,
    //   port: channel.config.smtpPort,
    //   secure: true,
    //   auth: {
    //     user: channel.config.username,
    //     pass: channel.config.password
    //   }
    // });
    
    // await transporter.sendMail({
    //   from: channel.config.fromEmail,
    //   to: channel.config.toEmails,
    //   subject: `${channel.config.subjectPrefix || '[ALERT]'} ${alert.type || alert.event.type}`,
    //   html: emailContent
    // });
  }

  private async sendWebhookAlert(alert: AlertMessage | SystemAlert, channel: WebhookChannel): Promise<void> {
    const payload = this.createWebhookPayload(alert);
    
    const response = await fetch(channel.config.url, {
      method: channel.config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...channel.config.headers
      },
      body: JSON.stringify(payload),
      signal: channel.config.timeout ? AbortSignal.timeout(channel.config.timeout) : undefined
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }

  private async sendSMSAlert(alert: AlertMessage | SystemAlert, channel: SMSChannel): Promise<void> {
    const message = this.createSMSContent(alert);
    
    switch (channel.config.provider) {
      case 'twilio':
        await this.sendTwilioSMS(message, channel);
        break;
      case 'aws-sns':
        await this.sendAWSSNS(message, channel);
        break;
      default:
        console.log(`[ALERT] SMS to ${channel.config.toNumbers.join(', ')}:`, message);
    }
  }

  private async sendTelegramAlert(alert: AlertMessage | SystemAlert, channel: TelegramChannel): Promise<void> {
    const message = this.createTelegramContent(alert);
    
    for (const chatId of channel.config.chatIds) {
      const url = `https://api.telegram.org/bot${channel.config.botToken}/sendMessage`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: channel.config.parseMode || 'HTML'
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API failed: ${response.status}`);
      }
    }
  }

  private createDiscordFields(alert: AlertMessage | SystemAlert): EmbedField[] {
    const fields: EmbedField[] = [];

    if ('event' in alert) {
      // AlertMessage
      const event = alert.event;
      
      fields.push({
        name: '🔗 Transaction',
        value: `[${event.signature.slice(0, 8)}...${event.signature.slice(-8)}](https://solscan.io/tx/${event.signature})`,
        inline: true
      });

      if (event.address) {
        fields.push({
          name: '👤 Address',
          value: `[${event.address.slice(0, 4)}...${event.address.slice(-4)}](https://solscan.io/account/${event.address})`,
          inline: true
        });
      }

      if (event.amount) {
        fields.push({
          name: '💰 Amount',
          value: event.amount.toString(),
          inline: true
        });
      }

      if (event.poolId) {
        fields.push({
          name: '🏦 Pool ID',
          value: event.poolId,
          inline: true
        });
      }

      if (event.taskId) {
        fields.push({
          name: '📝 Task ID',
          value: event.taskId,
          inline: true
        });
      }

      if (event.error) {
        fields.push({
          name: '❌ Error',
          value: `\`\`\`${event.error}\`\`\``,
          inline: false
        });
      }

      fields.push({
        name: '⏰ Timestamp',
        value: event.timestamp.toISOString(),
        inline: true
      });

      fields.push({
        name: '📊 Severity',
        value: this.getSeverityEmoji(alert.severity),
        inline: true
      });
    } else {
      // SystemAlert
      fields.push({
        name: '📋 Message',
        value: alert.message,
        inline: false
      });

      fields.push({
        name: '⏰ Timestamp',
        value: alert.timestamp.toISOString(),
        inline: true
      });

      fields.push({
        name: '📊 Severity',
        value: this.getSeverityEmoji(alert.severity),
        inline: true
      });
    }

    return fields;
  }

  private createSlackPayload(alert: AlertMessage | SystemAlert, channel: SlackChannel): any {
    const message = this.formatAlertMessage(alert);
    
    return {
      channel: channel.config.channel,
      username: channel.config.username,
      icon_emoji: channel.config.iconEmoji || ':warning:',
      text: message,
      attachments: [{
        color: this.getSlackColor(alert.severity),
        fields: this.createSlackFields(alert),
        footer: 'Smart Contract Monitoring',
        ts: Math.floor(Date.now() / 1000)
      }]
    };
  }

  private createEmailContent(alert: AlertMessage | SystemAlert): string {
    const message = this.formatAlertMessage(alert);
    
    return `
      <html>
        <body>
          <h2>🚨 Smart Contract Alert</h2>
          <p><strong>Message:</strong> ${message}</p>
          <p><strong>Timestamp:</strong> ${alert.timestamp.toISOString()}</p>
          <p><strong>Severity:</strong> ${this.getSeverityText(alert.severity)}</p>
          ${'event' in alert ? `<p><strong>Transaction:</strong> <a href="https://solscan.io/tx/${alert.event.signature}">${alert.event.signature}</a></p>` : ''}
        </body>
      </html>
    `;
  }

  private createWebhookPayload(alert: AlertMessage | SystemAlert): any {
    return {
      type: 'smart_contract_alert',
      timestamp: alert.timestamp.toISOString(),
      severity: this.getSeverityText(alert.severity),
      message: this.formatAlertMessage(alert),
      data: 'event' in alert ? alert.event : alert
    };
  }

  private createSMSContent(alert: AlertMessage | SystemAlert): string {
    const message = this.formatAlertMessage(alert);
    return `ALERT: ${message}`;
  }

  private createTelegramContent(alert: AlertMessage | SystemAlert): string {
    const message = this.formatAlertMessage(alert);
    const severity = this.getSeverityEmoji(alert.severity);
    
    return `${severity} <b>Smart Contract Alert</b>\n\n${message}`;
  }

  private formatAlertMessage(alert: AlertMessage | SystemAlert): string {
    if ('event' in alert) {
      const event = alert.event;
      return `${event.type}: ${event.error || 'Event occurred'} - ${event.signature}`;
    } else {
      return alert.message;
    }
  }

  private getDiscordColor(severity: AlertSeverity): number {
    switch (severity) {
      case AlertSeverity.LOW:
        return WebhookColor.INFO;
      case AlertSeverity.MEDIUM:
        return WebhookColor.WARNING;
      case AlertSeverity.HIGH:
        return WebhookColor.ERROR;
      case AlertSeverity.CRITICAL:
        return WebhookColor.ERROR;
      default:
        return WebhookColor.INFO;
    }
  }

  private getSlackColor(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.LOW:
        return '#36a64f';
      case AlertSeverity.MEDIUM:
        return '#ff9500';
      case AlertSeverity.HIGH:
        return '#ff0000';
      case AlertSeverity.CRITICAL:
        return '#8b0000';
      default:
        return '#36a64f';
    }
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.LOW:
        return '🟢 Low';
      case AlertSeverity.MEDIUM:
        return '🟡 Medium';
      case AlertSeverity.HIGH:
        return '🔴 High';
      case AlertSeverity.CRITICAL:
        return '🚨 Critical';
      default:
        return '⚪ Unknown';
    }
  }

  private getSeverityText(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.LOW:
        return 'Low';
      case AlertSeverity.MEDIUM:
        return 'Medium';
      case AlertSeverity.HIGH:
        return 'High';
      case AlertSeverity.CRITICAL:
        return 'Critical';
      default:
        return 'Unknown';
    }
  }

  private createSlackFields(alert: AlertMessage | SystemAlert): any[] {
    const fields: any[] = [];

    if ('event' in alert) {
      const event = alert.event;
      
      fields.push({
        title: 'Transaction',
        value: event.signature,
        short: true
      });

      if (event.address) {
        fields.push({
          title: 'Address',
          value: event.address,
          short: true
        });
      }

      if (event.amount) {
        fields.push({
          title: 'Amount',
          value: event.amount.toString(),
          short: true
        });
      }
    }

    fields.push({
      title: 'Severity',
      value: this.getSeverityText(alert.severity),
      short: true
    });

    return fields;
  }

  private async sendTwilioSMS(message: string, channel: SMSChannel): Promise<void> {
    // TODO: Implement Twilio SMS sending
    console.log(`[ALERT] Twilio SMS to ${channel.config.toNumbers.join(', ')}:`, message);
  }

  private async sendAWSSNS(message: string, channel: SMSChannel): Promise<void> {
    // TODO: Implement AWS SNS SMS sending
    console.log(`[ALERT] AWS SNS SMS to ${channel.config.toNumbers.join(', ')}:`, message);
  }

  private isInCooldown(rule: AlertRule): boolean {
    if (!rule.cooldown || !rule.lastTriggered) {
      return false;
    }

    const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
    return timeSinceLastTrigger < rule.cooldown;
  }

  private setCooldown(rule: AlertRule): void {
    rule.lastTriggered = new Date();
    
    // Clear existing timer
    const existingTimer = this.cooldownTimers.get(rule.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.cooldownTimers.delete(rule.id);
    }, rule.cooldown);

    this.cooldownTimers.set(rule.id, timer);
  }

  private addToHistory(alertMessage: AlertMessage): void {
    this.alertHistory.push(alertMessage);
    
    // Keep history size manageable
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }
  }

  public getAlertHistory(limit: number = 100): AlertMessage[] {
    return this.alertHistory.slice(-limit);
  }

  public getChannelStatus(): Array<{ name: string; type: string; enabled: boolean }> {
    return Array.from(this.channels.values()).map(channel => ({
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled
    }));
  }
} 