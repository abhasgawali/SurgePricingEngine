import { BaseError } from './base.error'

export class ConfigError extends BaseError {
  constructor(message: string = 'Configuration error', metadata: Record<string, any> = {}) {
    super(message, 500, 'CONFIG_ERROR', metadata)
  }
}

