import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'
import { coreMiddleware } from '../../middlewares/core.middleware'

const SuccessResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  resetValues: z.object({
    currentPrice: z.number(),
    competitorPrice: z.number(),
    stockLevel: z.number()
  })
})

const ErrorResponseSchema = z.object({
  error: z.string(),
  data: z.array(z.any()).optional()
})

export const config: ApiRouteConfig = {
  name: 'Reset',
  type: 'api',
  path: '/debug/reset',
  method: 'POST',
  emits: [],
  description: 'Reset pricing and stock to default values - sets current price to $100, competitor price to $100, and stock to 1000',
  flows: ['debug'],
  virtualSubscribes: [],
  responseSchema: {
    200: SuccessResponseSchema,
    500: ErrorResponseSchema
  },
  middleware: [coreMiddleware]
}

const DEFAULT_VALUES = {
  currentPrice: 100,
  competitorPrice: 100,
  stockLevel: 1000
}

export const handler: Handlers['Reset'] = async (_req, { logger, state, streams }) => {
  try {
    logger.info('🔄 Reset API called - resetting to default values', DEFAULT_VALUES)

    // 1. Reset current price
    await state.set('pricing', 'current_price', DEFAULT_VALUES.currentPrice)
    await state.set('pricing', 'last_pricing_ts', Date.now())
    await state.set('pricing', 'last_pricing_decision', 'hold')
    await state.set('pricing', 'last_pricing_reason', 'Reset to default')

    // 2. Reset competitor price signal
    await state.set('signals', 'competitor_price', DEFAULT_VALUES.competitorPrice)
    
    // 3. Reset our stock level (this is our inventory, not a signal)
    await state.set('inventory', 'our_stock', DEFAULT_VALUES.stockLevel)
    
    // 4. Reset stock drop signal (if any)
    await state.set('signals', 'stock_drop', DEFAULT_VALUES.stockLevel)

    // 4. Clear any stored market signals
    try {
      await state.clear('market_signals')
      logger.debug('Cleared stored market signals')
    } catch (clearError: any) {
      logger.warn('Failed to clear market signals', { error: clearError.message })
    }

    // 5. Update the price stream
    try {
      await streams.price_stream.set(
        'price:public',
        'current',
        {
          price: DEFAULT_VALUES.currentPrice,
          previousPrice: DEFAULT_VALUES.currentPrice,
          decision: 'hold',
          reason: 'Reset to default values',
          timestamp: new Date().toISOString()
        }
      )
      logger.info('Price stream updated with reset values')
    } catch (streamError: any) {
      logger.warn('Failed to update price stream', { error: streamError.message })
      // Non-critical, continue
    }

    logger.info('✅ Reset completed successfully', DEFAULT_VALUES)

    return {
      status: 200,
      body: {
        ok: true,
        message: 'Successfully reset to default values',
        resetValues: DEFAULT_VALUES
      }
    }
  } catch (error: any) {
    logger.error('Failed to reset values', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

