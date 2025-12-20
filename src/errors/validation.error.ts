import { BaseError } from './base.error'

export class ValidationError extends BaseError {
  constructor(message: string = 'Validation failed', metadata: Record<string, any> = {}) {
    super(message, 400, 'VALIDATION_ERROR', metadata)
  }
}

