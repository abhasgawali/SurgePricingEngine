import { EventConfig, Handlers } from 'motia'
import { z } from 'zod'

export const config: EventConfig = {
  name: 'PricingAgent',
  type: 'event',
  description: 'Autonomous AI agent that sets prices based on market signals using Gemini',
  subscribes: ['market.signal'],
  input: z.object({
    type: z.enum(['demand_surge', 'competitor_price', 'stock_drop']),
    value: z.number(),
    reason: z.string().optional(),
    timestamp: z.string(),
    source: z.string()
  }),
  emits: ['price.updated']
}

export const handler: Handlers['PricingAgent'] = async (event, { logger, state, emit }) => {
  const signal = event
  logger.info(`🤖 Agent Active: Analyzing ${signal.type}`)

  // --- CHECK API KEY ---
  const API_KEY = process.env.GEMINI_API_KEY
  if (!API_KEY) {
    logger.error("❌ CRITICAL: GEMINI_API_KEY is missing in .env file")
    return
  }

  // --- GATHER CONTEXT ---
  const currentPrice = (await state.get<number>('pricing', 'current_price')) || 100
  const competitorPrice = (await state.get<number>('pricing', 'competitor_price')) || 105
  const stockLevel = (await state.get<number>('pricing', 'stock_level')) || 500

  // --- PREPARE PROMPT ---
  const prompt = `
    You are an expert Revenue Management AI.
    CURRENT STATE: Our Price: $${currentPrice}, Competitor: $${competitorPrice}, Stock: ${stockLevel}
    INCOMING SIGNAL: ${signal.type} value ${signal.value}
    
    Task: Decide price change (increase, decrease, hold).
    Output JSON ONLY: { "new_price": number, "reasoning": "string", "decision": "string" }
  `

  // --- CALL GEMINI API (FIXED MODEL NAME) ---
  // Using the stable 'gemini-1.5-flash'
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`
  
  let result = { 
    new_price: currentPrice, 
    reasoning: "Calculating...", 
    decision: "hold" 
  }

  try {
    const response = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    })

    if (!response.ok) {
      const errorText = await response.text() 
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`)
    }
    
    const data = await response.json()
    const textResponse = data.candidates[0].content.parts[0].text
    result = JSON.parse(textResponse)
    
    logger.info("🧠 Gemini Decision", result)

  } catch (error: any) {
    logger.error("⚠️ AI Offline - Using Fallback", { message: error.message })
    
    // Fallback logic
    if (signal.type === 'competitor_price' && signal.value < currentPrice) {
      result.new_price = signal.value - 0.5
      result.reasoning = "Competitor undercut detected (Fallback)."
      result.decision = "decrease"
    }
  }

  // --- UPDATE STATE & EMIT ---
  await state.set('pricing', 'current_price', result.new_price)
  await emit({
    topic: 'price.updated',
    data: {
      price: result.new_price,
      previousPrice: currentPrice,
      competitorPrice: (signal.type === 'competitor_price' ? signal.value : competitorPrice),
      reason: result.reasoning,
      decision: result.decision,
      timestamp: new Date().toISOString()
    }
  })
}