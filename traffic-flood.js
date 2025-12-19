// traffic-flood.js
const API_URL = 'http://localhost:3000/simulate'; // Standard Motia endpoint

async function sendSignal(i) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'demand_surge',
        value: Math.floor(Math.random() * 5) + 1,
        reason: `User ${i} viewing item`
      })
    });
    if (response.ok) console.log(`✅ Req ${i}: Sent`);
    else console.log(`❌ Req ${i}: Error ${response.status}`);
  } catch (e) {
    console.error(`🚨 Req ${i} Failed: Is Backend running on port 3000?`);
  }
}

async function runFlood() {
  console.log(`🌊 STARTING TRAFFIC FLOOD to ${API_URL}...`);
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(sendSignal(i));
    await new Promise(r => setTimeout(r, 20)); 
  }
  await Promise.all(promises);
  console.log("✅ FLOOD COMPLETE");
}

runFlood();