````markdown
# 💸 SurgePricing.AI

**A Real-Time Autonomous Pricing Engine powered by Motia & OpenAI GPT-4o.**

SurgePricing.AI is an event-driven system that adjusts product prices in real-time based on market demand, competitor data, and stock levels. It uses **Motia** for backend orchestration and **WebSockets** for live frontend streaming.


---

## 🚀 Features

* **⚡ Real-Time Telemetry:** Live visualization of price vs. demand velocity using high-frequency WebSockets.
* **🧠 Autonomous AI Agent:** An OpenAI GPT-4o agent analyzes market signals (undercuts, surges) to make reasoning-based pricing decisions.
* **🌊 Event-Driven Architecture:** Built on **Motia**, replacing complex microservices with simple "Steps" (Events, APIs, Streams).
* **🛡️ Protective Guardrails:** Built-in cooldowns and stock protection logic to prevent AI hallucinations.

---

## 🏗️ Architecture

The system is built using the **Motia** framework (`npx motia create`), unifying the backend logic into a single event loop.

1.  **Ingestion:** `view-tracker` captures user traffic and aggregates velocity.
2.  **Orchestration:** `market-ticker` runs a Cron job to evaluate traffic density.
3.  **Intelligence:** `pricing-agent` (The AI) wakes up on signals, queries GPT-4o, and decides the new price.
4.  **Streaming:** `price_stream` pushes the new state directly to the React Frontend via WebSockets (Port 3000).

---

## 🛠️ Setup & Installation

### Prerequisites
* Node.js v18+
* OpenAI API Key

### 1. Clone & Install
```bash
git clone <your-repo-url>
cd surge-pricing-engine

# Install Backend
npm install

# Install Frontend
cd client-side
npm install
cd ..
````

### 2. Configure Environment

Create a `.env` file in the root directory:

```env
# Backend .env
OPENAI_API_KEY=sk-your-openai-key-here
PRICING_COOLDOWN_SECONDS=10
OPENAI_MODEL=gpt-4o
```

---

## 🚦 How to Run the Demo

### Step 1: Start the Backend (Motia)

In the root folder:

```bash
npm run dev
# > Motia Workbench running at http://localhost:3000
```

### Step 2: Start the Frontend (Vite)

Open a new terminal in `client-side`:

```bash
cd client-side
npm run dev
# > Local: http://localhost:5173
```

### Step 3: Trigger a Demand Surge 🌊

The system reacts to traffic. Open a **third terminal** and run the simulation script to flood the engine with fake traffic events:

```bash
node traffic-flood.js
```

**Watch the Dashboard:**

1. The "Demand" (Blue Area) will spike.
2. The AI Log will show "Analyzing Demand Surge".
3. The Price (Green Line) will automatically increase to capture revenue.

---

## 📂 Project Structure

```
├── steps/                  # Motia Backend Logic
│   ├── engine/
│   │   └── pricing-agent.step.ts   # AI Logic (GPT-4o)
│   ├── ingestion/
│   │   └── view-tracker.step.ts    # Traffic Counter
│   ├── streams/
│   │   └── price.stream.ts         # WebSocket Definition
│   └── orchestration/
│       └── market-ticker.step.ts   # Cron Job
├── client-side/            # React Frontend
│   ├── src/App.tsx         # Dashboard UI (Recharts + Stream SDK)
│   └── vite.config.ts      # Proxy Configuration
└── traffic-flood.js        # Simulation Script
```

---

## 🧠 AI Decision Logic


```
```
