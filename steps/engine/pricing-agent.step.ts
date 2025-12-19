import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'PricingAgent',
  type: 'event',
  description: 'Autonomous AI agent that sets prices based on market signals using OpenAI',
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

export const handler: Handlers['PricingAgent'] = async (event, { logger, state, emit, streams }) => {
  const signal = event
  logger.info(`🤖 Agent Active: Analyzing ${signal.type}`)

  // 1. CHECK API KEY
  const OPENAI_KEY = process.env.OPENAI_API_KEY
  const GEMINI_KEY = process.env.GEMINI_API_KEY
  
  if (!OPENAI_KEY && !GEMINI_KEY) {
    logger.error("❌ CRITICAL: No AI API Key found (OPENAI_API_KEY or GEMINI_API_KEY) in .env")
    return
  }

  // 2. GATHER CONTEXT
  const currentPrice = (await state.get<number>('pricing', 'current_price')) || 100
  const competitorPrice = (await state.get<number>('pricing', 'competitor_price')) || 105
  const stockLevel = (await state.get<number>('pricing', 'stock_level')) || 500

  // 3. COOLDOWN
  const lastTs = (await state.get<number>('pricing', 'last_pricing_ts')) || 0
  const COOLDOWN_SECONDS = Number(process.env.PRICING_COOLDOWN_SECONDS) || 20
  if (Date.now() - lastTs < COOLDOWN_SECONDS * 1000) {
    logger.info('Skipping pricing - cooldown active')
    return
  }

  // 4. PREPARE PROMPT
  const systemPrompt = `You are an expert Revenue Management AI. Output valid JSON only.`
  const userPrompt = `
    CURRENT STATE: Our Price: $${currentPrice}, Competitor: $${competitorPrice}, Stock: ${stockLevel}
    INCOMING SIGNAL: ${signal.type} value ${signal.value}
    Task: Decide price change (increase, decrease, hold).
    Rules:
    - If demand surge > 10, consider raising price.
    - If competitor undercuts, match only if > $80.
    - Output JSON: { "new_price": number, "reasoning": "string", "decision": "increase" | "decrease" | "hold" }
  `

  // 5. CALL AI MODEL
  let result = { new_price: currentPrice, reasoning: 'Calculating...', decision: 'hold' } as const

  try {
    if (OPENAI_KEY) {
      // --- OPENAI PATH ---
      const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.7
        })
      })

      if (!response.ok) throw new Error(`OpenAI Error: ${response.status}`)
      const data = await response.json()
      const content = JSON.parse(data.choices[0].message.content)
      result = {
        new_price: content.new_price,
        reasoning: content.reasoning,
        decision: content.decision
      }
    } else if (GEMINI_KEY) {
      // --- GEMINI PATH ---
      // Uses Gemini 1.5 Flash by default for speed
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: systemPrompt + "\n" + userPrompt }]
          }],
          generationConfig: {
            response_mime_type: "application/json"
          }
        })
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Gemini Error: ${response.status} - ${errText}`)
      }
      
      const data = await response.json()
      // Gemini returns candidates[0].content.parts[0].text
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error("Gemini returned empty response")
      
      const content = JSON.parse(text)
      result = {
        new_price: content.new_price,
        reasoning: content.reasoning,
        decision: content.decision
      }
    }
  } catch (error: any) {
    logger.error('⚠️ AI call failed', { message: error?.message })
    // Fallback if AI fails
    if (signal.type === 'competitor_price' && signal.value < currentPrice) {
      result = { new_price: signal.value - 0.5, reasoning: 'Competitor undercut detected (Fallback).', decision: 'decrease' }
    }
  }

  // 6. UPDATE STATE & EMIT
  await state.set('pricing', 'current_price', result.new_price)
  await state.set('pricing', 'last_pricing_ts', Date.now())
  
  const payload = {
    price: result.new_price,
    previousPrice: currentPrice,
    competitorPrice: (signal.type === 'competitor_price' ? signal.value : competitorPrice),
    reason: result.reasoning.substring(0, 250),
    decision: result.decision,
    timestamp: new Date().toISOString(),
    stockLevel: stockLevel,
    velocity: typeof (signal as any).value === 'number' ? (signal as any).value : 0
  }

  // 7. PUBLISH TO STREAM (Using set for persistence)
  // This matches 'useStreamItem' in the frontend
  try {
    await streams.price_stream.set(
      'price:public', // Group ID
      'current',      // Item ID
      payload
    )
    logger.info('Stream updated', { price: result.new_price })
  } catch (err: any) {
    logger.warn('Stream publish failed', { error: err.message })
  }
}