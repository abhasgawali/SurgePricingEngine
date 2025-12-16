import { ApiRouteConfig, Handlers, Logger } from 'motia'
import { z } from 'zod'

const SimulateSignalSchema = z.object({
    type: z.enum(['demand_surge', 'competitor_price', 'stock_drop']),
    value: z.number(),
    reason: z.string().optional()
  })
// 1. Configuration: Defines the API route and the event it triggers
export const config: ApiRouteConfig = {
  name: 'SimulateSignal',
  type: 'api',
  path: '/simulate',      
  method: 'POST',
  emits: ['market.signal'], // This connects to your Pricing Engine
  description: 'Manually inject market signals (demand, competitor prices) for the demo',
  flows: ['simulator'],
  // Validation 
  bodySchema: SimulateSignalSchema
}

// 2. Handler: The logic that runs when the API is hit
export const handler: Handlers['SimulateSignal'] = async (req, { logger , emit }) => {
  const signal = req.body

  // Log it so you can see it in the Motia Workbench "Logs" tab immediately
  logger.info('🔌 Manual Signal Injected', { signal })

  // Emit the event to wake up the Pricing Engine
  await emit({
    topic: 'market.signal',
    data: {
      ...signal,
      timestamp: new Date().toISOString(),
      source: 'manual_simulation'
    }
  })

  return {
    status: 200,
    body: { ok: true, message: 'Signal emitted' }
  }
}