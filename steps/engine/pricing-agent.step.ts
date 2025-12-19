import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'PricingAgent',
  type: 'event',
  description: 'Optimized pricing agent with significance gating',
  subscribes: ['market.signal'],
  input: z.object({
    type: z.enum(['demand_surge', 'competitor_price', 'stock_drop']),
    value: z.number(),
    reason: z.string().optional(),
    timestamp: z.string(),
    source: z.string()
  }),
  emits: ['price.updated'],
  flows: ['intelligence']
}

const THRESHOLDS = {
  demand_surge_pct: 0.15,      // 15% delta
  competitor_price_pct: 0.05,  // 5% delta
  stock_drop_pct: 0.20         // 20% drop
}

export const handler: Handlers['PricingAgent'] = async (
  event,
  { logger, state, streams }
) => {
  const signal = event

  // 1. API KEY CHECK
  const GROQ_KEY = process.env.GROQ_API_KEY
  if (!GROQ_KEY) {
    logger.error('❌ GROQ_API_KEY missing')
    return
  }

  // 2. LOAD STATE
  const currentPrice =
    (await state.get<number>('pricing', 'current_price')) || 100

  const lastSignalValue =
    (await state.get<number>('signals', signal.type)) ?? signal.value

  // 3. SIGNIFICANCE CHECK (NO LLM YET)
  const delta = signal.value - lastSignalValue
  const pctChange =
    lastSignalValue === 0 ? 0 : Math.abs(delta / lastSignalValue)

  let isSignificant = false

  switch (signal.type) {
    case 'demand_surge':
      isSignificant = pctChange >= THRESHOLDS.demand_surge_pct
      break

    case 'competitor_price':
      isSignificant = pctChange >= THRESHOLDS.competitor_price_pct
      break

    case 'stock_drop':
      isSignificant =
        delta < 0 && pctChange >= THRESHOLDS.stock_drop_pct
      break
  }

  if (!isSignificant) {
    logger.info('⏭️ Skipping LLM — signal not significant', {
      type: signal.type,
      pctChange: (pctChange * 100).toFixed(2) + '%'
    })

    // Still update last seen signal
    await state.set('signals', signal.type, signal.value)
    return
  }

  logger.info('🚨 Significant signal detected → calling LLM', {
    type: signal.type,
    pctChange: (pctChange * 100).toFixed(2) + '%'
  })

  // 4. PROMPTS
  const systemPrompt =
    'You are an expert Revenue Management AI. Output valid JSON only.'

  const userPrompt = `
CURRENT PRICE: $${currentPrice}
SIGNAL TYPE: ${signal.type}
SIGNAL VALUE: ${signal.value}
CHANGE VS LAST: ${(pctChange * 100).toFixed(2)}%

Decide price action.

Rules:
- Demand surge → increase if justified
- Competitor price → match only if price > $80
- Stock drop → increase if scarcity risk

Return JSON ONLY:
{
  "new_price": number,
  "reasoning": "string",
  "decision": "increase" | "decrease" | "hold"
}
`

  // 5. GROQ CALL
  let result = {
    new_price: currentPrice,
    reasoning: 'No change',
    decision: 'hold' as const
  }

  try {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.6
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Groq ${response.status}`)
    }

    const data = await response.json()
    const content = JSON.parse(
      data.choices[0].message.content
    )

    result = {
      new_price: content.new_price,
      reasoning: content.reasoning,
      decision: content.decision
    }
  } catch (err: any) {
    logger.error('⚠️ LLM failed, using fallback', {
      error: err.message
    })

    // Deterministic fallback
    if (signal.type === 'competitor_price') {
      result = {
        new_price: Math.max(signal.value - 0.5, 80),
        reasoning: 'Competitor undercut (fallback)',
        decision: 'decrease'
      }
    }
  }

  // 6. SAVE STATE
  await state.set('pricing', 'current_price', result.new_price)
  await state.set('pricing', 'last_pricing_ts', Date.now())
  await state.set('signals', signal.type, signal.value)

  // 7. STREAM UPDATE
  try {
    await streams.price_stream.set(
      'price:public',
      'current',
      {
        price: result.new_price,
        previousPrice: currentPrice,
        decision: result.decision,
        reason: result.reasoning,
        timestamp: new Date().toISOString()
      }
    )
  } catch {}
}
