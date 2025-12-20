import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'ViewAggregator',
  type: 'event',
  description: 'Consumes internal view events and appends them to an events log for safe aggregation',
  subscribes: ['internal.view_recorded'],
  input: z.object({
    itemId: z.string().min(1, 'Item ID is required'),
    userId: z.string().nullable().optional(),
    ts: z.string().datetime('Timestamp must be a valid ISO datetime')
  }),
  emits: [],
  flows: ['ingestion'],
  virtualEmits: ['views.aggregated'] // Document connection to market ticker
}

export const handler: Handlers['ViewAggregator'] = async (event, { state, logger }) => {
  try {
    const { itemId, userId, ts } = event

    if (!itemId || !ts) {
      logger.warn('ViewAggregator: Missing required fields', { event })
      return
    }

    // Validate timestamp
    const timestamp = new Date(ts)
    if (isNaN(timestamp.getTime())) {
      logger.warn('ViewAggregator: Invalid timestamp', { ts, event })
      return
    }

    // Append an event to an append-only group to avoid concurrent counter writes.
    // Market ticker / aggregator will process and reduce these into per-minute counters periodically.
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const payload = { 
      itemId, 
      userId: userId ?? null, 
      ts 
    }

    await state.set('views_events', id, payload)

    logger.debug('View appended to events log', { 
      id, 
      itemId,
      timestamp: ts
    })
  } catch (err: any) {
    logger.error('ViewAggregator: Failed to append view event', { 
      error: err?.message ?? String(err),
      stack: err?.stack,
      event 
    })
    // Don't throw - allow event processing to continue
    // Event steps should be resilient to individual failures
  }
}
