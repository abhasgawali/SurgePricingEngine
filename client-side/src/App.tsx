import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, Bot, Activity, TrendingUp, TrendingDown, Minus, BrainCircuit, ArrowRightLeft } from 'lucide-react'
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts'
import { MotiaStreamProvider, useStreamGroup } from '@motiadev/stream-client-react'

// --- TYPES ---
interface PriceUpdate {
   id: string
   type: 'signal' | 'decision'
   price: number
   previousPrice: number
   competitorPrice?: number | null 
   stockLevel?: number | null      
   velocity?: number | null        
   reason: string
   decision: 'increase' | 'decrease' | 'hold'
   timestamp: string
   signalType?: string
   signalValue?: number
}

interface ChatMessage {
   id: string
   role: 'ai' | 'market' // Differentiate users
   timestamp: string
   text: string
   meta?: any
}

function Dashboard() {
   const [graphData, setGraphData] = useState<any[]>([])
   const [messages, setMessages] = useState<ChatMessage[]>([])
   const [isThinking, setIsThinking] = useState(false)

   const { data: items, event } = useStreamGroup<PriceUpdate>({
      streamName: 'price_stream',
      groupId: 'price:public'
   })

   const isConnected = event !== null
   const streamData = items?.find(i => i.id === 'current')
   const scrollRef = useRef<HTMLDivElement>(null)

   // 3. REACT TO DATA
   useEffect(() => {
      if (!streamData) return

      setGraphData(prev => {
         const newData = {
            time: new Date(streamData.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
            price: streamData.price,
            competitor: streamData.competitorPrice || null, // Handle nulls for chart
            demand: streamData.velocity || 0
         }
         // Prevent duplicate points if timestamp is same
         if (prev.length > 0 && prev[prev.length-1].time === newData.time) return prev
         
         const newArr = [...prev, newData]
         if (newArr.length > 20) newArr.shift()
         return newArr
      })

      // Chat Logic
      if (streamData.type === 'signal') {
         setIsThinking(true) // Show thinking bubble
         setMessages(prev => {
            // Dedup
            if (prev.length > 0 && prev[prev.length - 1].timestamp === streamData.timestamp && prev[prev.length-1].role === 'market') return prev
            
            return [...prev, {
               id: Date.now().toString(),
               role: 'market',
               timestamp: streamData.timestamp,
               text: `Incoming Signal: ${streamData.signalType?.replace('_', ' ').toUpperCase()} detected. Value: ${streamData.signalValue}`,
            }]
         })
      } 
      else if (streamData.type === 'decision') {
         setIsThinking(false) // Hide thinking bubble
         setMessages(prev => {
            // Dedup
            if (prev.length > 0 && prev[prev.length - 1].timestamp === streamData.timestamp && prev[prev.length-1].role === 'ai') return prev

            return [...prev, {
               id: Date.now().toString(),
               role: 'ai',
               timestamp: streamData.timestamp,
               text: streamData.reason,
               meta: { decision: streamData.decision, price: streamData.price }
            }]
         })
      }
   }, [streamData])

   // Auto-scroll chat
   useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
   }, [messages, isThinking])

   const getStockColor = (level: number) => {
      if (level < 200) return 'text-red-400'
      if (level < 500) return 'text-yellow-400'
      return 'text-green-400'
   }

   const getDecisionIcon = (decision?: string) => {
      if (decision === 'increase') return <TrendingUp size={32} className="text-green-400" />
      if (decision === 'decrease') return <TrendingDown size={32} className="text-red-400" />
      return <Minus size={32} className="text-blue-400" />
   }

   return (
      <div className="min-h-screen bg-[#0B1121] text-white p-6 font-sans flex flex-col">
         {/* HEADER */}
         <header className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-slate-800/50 pb-6 shrink-0">
            <div>
               <h1 className="text-4xl md:text-6xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent mb-2">
                  SURGE<span className="text-white">PRICING</span>.AI
               </h1>
               <p className="text-slate-400 text-sm font-mono tracking-wide">
                  MOTIA ARCHITECTURE • REAL-TIME STREAMS • GPT-4o
               </p>
            </div>
            <div className={`flex items-center gap-3 px-5 py-2 rounded-full text-sm font-bold border transition-all shadow-lg ${isConnected
               ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400 shadow-emerald-900/20'
               : 'bg-red-950/40 border-red-500/50 text-red-400'}`}>
               {isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
               {isConnected ? 'LIVE FEED ACTIVE' : `CONNECTING...`}
            </div>
         </header>

         <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 flex-1 min-h-0">
            {/* LEFT COLUMN: METRICS & CHART */}
            <div className="xl:col-span-7 flex flex-col gap-8 min-h-0">
               {/* MAIN KPI CARD */}
               <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
                  <div className={`absolute top-0 right-0 w-[500px] h-[500px] -translate-y-1/2 translate-x-1/2 rounded-full blur-[120px] opacity-20 transition-colors duration-700 ${streamData?.decision === 'increase' ? 'bg-green-500' :
                     streamData?.decision === 'decrease' ? 'bg-red-500' : 'bg-blue-500'
                     }`} />

                  <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                     <div>
                        <h2 className="text-slate-500 text-sm font-bold uppercase tracking-widest mb-1">Current Price Point</h2>
                        <div className="flex items-center gap-4">
                           <div className="flex items-start text-8xl md:text-9xl font-bold tracking-tighter text-white drop-shadow-2xl">
                              <span className="text-5xl text-slate-600 mt-4 mr-2">$</span>
                              {streamData?.price?.toFixed(2) ?? '---'}
                           </div>
                           <div className="hidden md:block animate-pulse">{getDecisionIcon(streamData?.decision)}</div>
                        </div>
                     </div>

                     <div className="flex flex-row md:flex-col gap-4 w-full md:w-auto">
                        <div className="flex-1 bg-slate-950/60 p-4 rounded-xl border border-slate-800 min-w-[160px] text-right">
                           <div className="text-xs text-slate-500 uppercase font-bold mb-1">Competitor</div>
                           {/* FIXED: Now correctly displays data from stream */}
                           <div className="font-mono text-2xl text-white">
                              {streamData?.competitorPrice ? `$${streamData.competitorPrice.toFixed(2)}` : '---'}
                           </div>
                        </div>
                        <div className="flex-1 bg-slate-950/60 p-4 rounded-xl border border-slate-800 min-w-[160px] text-right">
                           <div className="text-xs text-slate-500 uppercase font-bold mb-1">Stock Level</div>
                           {/* FIXED: Now correctly displays data from stream */}
                           <div className={`font-mono text-2xl ${getStockColor(streamData?.stockLevel ?? 0)}`}>
                              {streamData?.stockLevel ?? '---'}
                           </div>
                        </div>
                     </div>
                  </div>
               </div>

               {/* CHART CARD */}
               <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col shadow-xl">
                  <div className="flex justify-between items-center mb-6 px-2">
                     <h3 className="font-bold text-slate-300 flex items-center gap-2 tracking-wide">
                        <Activity size={20} className="text-blue-400" /> MARKET TELEMETRY
                     </h3>
                     <div className="flex gap-4 text-xs font-mono">
                        <span className="text-green-400 flex items-center gap-1">● Our Price</span>
                        <span className="text-red-400 flex items-center gap-1">-- Competitor</span>
                        <span className="text-blue-400 flex items-center gap-1">■ Demand</span>
                     </div>
                  </div>

                  <div className="w-full relative" style={{ height: 400 }}>
                     {graphData.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-slate-600 font-mono animate-pulse">
                           Waiting for signal...
                        </div>
                     )}
                     <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={graphData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                           <defs>
                              <linearGradient id="colorDemand" x1="0" y1="0" x2="0" y2="1">
                                 <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                 <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                              </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                           <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 12, fill: '#94a3b8' }} tickMargin={10} />
                           <YAxis yAxisId="left" stroke="#64748b" tick={{ fontSize: 12, fill: '#94a3b8' }} domain={['auto', 'auto']} />
                           <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" tick={{ fontSize: 12 }} />
                           <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} itemStyle={{ color: '#fff' }} />
                           <Area yAxisId="right" type="monotone" dataKey="demand" stroke="#3b82f6" fill="url(#colorDemand)" strokeWidth={3} />
                           <Line yAxisId="left" type="stepAfter" dataKey="price" stroke="#4ade80" strokeWidth={4} dot={false} activeDot={{ r: 8, strokeWidth: 0 }} />
                           <Line yAxisId="left" type="step" dataKey="competitor" stroke="#ef4444" strokeDasharray="6 6" strokeWidth={2} dot={false} />
                        </ComposedChart>
                     </ResponsiveContainer>
                  </div>
               </div>
            </div>

            {/* RIGHT COLUMN: STRATEGY CHAT LOG */}
            <div className="xl:col-span-5 bg-[#0f1623] border border-slate-800 rounded-3xl flex flex-col overflow-hidden h-full max-h-[calc(100vh-140px)] shadow-2xl">
               <div className="p-6 bg-slate-900/90 border-b border-slate-800 flex justify-between items-center backdrop-blur z-10">
                  <div className="flex items-center gap-3">
                     <div className="p-2 bg-purple-500/10 rounded-lg"><Bot size={24} className="text-purple-400" /></div>
                     <div>
                        <div className="font-bold text-slate-200 tracking-wide">STRATEGY LOG</div>
                        <div className="text-xs text-slate-500">Autonomous Reasoning Engine</div>
                     </div>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth" ref={scrollRef}>
                  {messages.length === 0 && (
                     <div className="text-center text-slate-600 mt-20 text-sm">Waiting for market events...</div>
                  )}
                  
                  {messages.map((msg, i) => (
                     <div key={i} className={`animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col ${msg.role === 'market' ? 'items-start' : 'items-end'}`}>
                        {/* Header for Message */}
                        <div className="flex items-center gap-2 mb-2">
                           <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                           </span>
                           {msg.role === 'ai' && (
                              <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${msg.meta?.decision === 'increase' ? 'bg-green-500/20 text-green-400' :
                                 msg.meta?.decision === 'decrease' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                                 }`}>
                                 {msg.meta?.decision}
                              </span>
                           )}
                        </div>

                        {/* Message Bubble */}
                        <div className={`p-5 rounded-2xl border shadow-lg text-sm leading-relaxed max-w-[90%] ${
                           msg.role === 'market' 
                              ? 'bg-slate-800/80 border-slate-700 text-slate-300 rounded-tl-none' 
                              : 'bg-gradient-to-br from-indigo-900/50 to-slate-900/50 border-indigo-500/30 text-indigo-100 rounded-tr-none'
                        }`}>
                           {msg.role === 'market' && <ArrowRightLeft size={16} className="inline mr-2 text-slate-500"/>}
                           {msg.text}
                        </div>
                     </div>
                  ))}

                  {/* THINKING BUBBLE */}
                  {isThinking && (
                     <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col items-end">
                        <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl rounded-tr-none flex items-center gap-3">
                           <BrainCircuit size={18} className="text-purple-400 animate-pulse" />
                           <span className="text-xs text-slate-400 font-mono">Optimizing revenue strategy...</span>
                        </div>
                     </div>
                  )}
               </div>
            </div>
         </div>
      </div>
   )
}

function App() {
   return (
      <MotiaStreamProvider address="ws://localhost:3000">
         <Dashboard />
      </MotiaStreamProvider>
   )
}

export default App