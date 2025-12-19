import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'ViewAggregator',
  type: 'event',
  description: 'Consumes internal view events and appends them to an events log for safe aggregation',
  subscribes: ['internal.view_recorded'],
  input: z.object({
    itemId: z.string(),
    userId: z.string().optional(),
    ts: z.string()
  }),
  emits: [],
  flows: ['ingestion']
}

export const handler: Handlers['ViewAggregator'] = async (event, { state, logger }) => {
  const { itemId, userId, ts } = event

  try {
    // Append an event to an append-only group to avoid concurrent counter writes.
    // Market ticker / aggregator will process and reduce these into per-minute counters periodically.
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const payload = { itemId, userId: userId ?? null, ts }

    await state.set('views_events', id, payload)

    logger.debug('View appended to events log', { id, itemId })
  } catch (err: any) {
    logger.error('Failed to append view event', { error: err?.message ?? String(err), event })
  }
}
