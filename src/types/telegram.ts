export interface TelegramConfig {
  botToken: string
  channelId: string
  webhookSecret?: string
}

export interface TelegramMessage {
  chat_id: string
  text: string
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2'
  disable_web_page_preview?: boolean
}

export interface TelegramResponse {
  ok: boolean
  result?: any
  description?: string
  error_code?: number
}

export interface FactoryActivationNotification {
  factoryId: string
  factoryName: string
  ownerAddress: string
}