import { Handlers, EventConfig } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'ViewTracker',
  type: 'event',
  description: 'Tracks item views from frontend and emits internal events for aggregation',
  subscribes: ['item.viewed'], 
  input: z.object({
    itemId: z.string().min(1, 'Item ID is required'),
    userId: z.string().optional()
  }),
  emits: ['internal.view_recorded'],
  flows: ['ingestion'],
  virtualSubscribes: ['item.viewed'] // Document the flow from frontend
}

export const handler: Handlers['ViewTracker'] = async (event, { emit, logger }) => {
  try {
    const { itemId, userId } = event

    if (!itemId) {
      logger.warn('ViewTracker: Missing itemId in event', { event })
      return
    }

    const viewEvent = {
      itemId,
      userId: userId ?? null,
      ts: new Date().toISOString()
    }

    // Instead of mutating shared counters directly (race-prone), emit a compact internal event
    // that the `view-aggregator` will consume and append to the events log.
    await emit({ 
      topic: 'internal.view_recorded', 
      data: viewEvent 
    })
    
    logger.debug('👀 View recorded (emitted for aggregation)', { 
      itemId, 
      userId: userId ?? 'anonymous',
      timestamp: viewEvent.ts
    })
  } catch (error: any) {
    logger.error('ViewTracker: Failed to process view event', {
      error: error.message,
      stack: error.stack,
      event
    })
    // Don't throw - allow event processing to continue
    // Event steps should be resilient to individual failures
  }
}