import { Handlers, EventConfig } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'ViewTracker',
  type: 'event',
  // Listens to raw user events from the frontend
  subscribes: ['item.viewed'], 
  input: z.object({
    itemId: z.string(),
    userId: z.string().optional()
  }),
  emits: ['internal.view_recorded'],
  flows: ['ingestion']
}

export const handler: Handlers['ViewTracker'] = async (event, { emit, logger }) => {
  const { itemId, userId } = event

  // Instead of mutating shared counters directly (race-prone), emit a compact internal event
  // that the `view-aggregator` will consume and append to the events log.
  await emit({ topic: 'internal.view_recorded', data: { itemId, userId, ts: new Date().toISOString() } })
  logger.debug('👀 View recorded (emitted for aggregation)', { itemId, userId })
}