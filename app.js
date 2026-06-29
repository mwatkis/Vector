const STORE_KEY = "vector_decision_cockpit_v01";
let state = { flights: [] };
let activeFlightId = null;

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const pct = (n) => `${Math.round(clamp(n) * 100)}%`;
const nowIso = () => new Date().toISOString();

function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load(){
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || { flights: [] }; }
  catch { state = { flights: [] }; }
}

function normalizeText(text){ return (text || "").replace(/,/g, "").replace(/\u00a0/g, " ").replace(/[|]/g, " ").trim(); }
function numberAfter(text, labels){
  const clean = normalizeText(text).toLowerCase();
  for(const label of labels){
    const re = new RegExp(`${label}[^0-9]{0,28}(\\d+)`, "i");
    const m = clean.match(re);
    if(m) return Number(m[1]);
  }
  return null;
}
function moneyValues(text){
  const vals = [];
  const re = /\$\s*([0-9][0-9,]*(?:\.\d{2})?)/g;
  let m;
  while((m = re.exec(text || ""))) vals.push(Number(m[1].replace(/,/g,"")));
  return vals;
}
function parseCabinTable(text){
  const clean = normalizeText(text);
  const result = {};
  const labels = ["authorized", "capacity", "booked", "held", "avail", "available"];
  const lines = clean.split(/\n+/).map(l => l.trim()).filter(Boolean);

  // Pattern: Available 0 0 8 or Available: J 0 O 0 Y 8
  for(const line of lines){
    const low = line.toLowerCase();
    for(const label of labels){
      if(low.includes(label)){
        const nums = line.match(/-?\d+/g)?.map(Number) || [];
        if(nums.length >= 3){
          const key = label.startsWith("avail") ? "available" : label;
          result[key] = { J: nums[0], O: nums[1], Y: nums[2] };
        }
      }
    }
  }
  // Pattern: J: 3/16, O: 0/0, Y 142/150
  for(const c of ["J","O","Y"]){
    const re = new RegExp(`${c}[^0-9]{0,12}(\\d+)\\s*[/]\\s*(\\d+)`, "i");
    const m = clean.match(re);
    if(m){
      result.booked = result.booked || {};
      result.capacity = result.capacity || {};
      result.available = result.available || {};
      result.booked[c] = Number(m[1]);
      result.capacity[c] = Number(m[2]);
      result.available[c] = Math.max(0, Number(m[2]) - Number(m[1]));
    }
  }
  return result;
}
function parseStandbyRows(text){
  const clean = normalizeText(text);
  const rows = [];
  const lines = clean.split(/\n+/).map(l => l.trim()).filter(Boolean);
  for(const line of lines){
    const priority = line.match(/\b(SA\d[A-Z]?|SA[A-Z0-9]{2,4})\b/i)?.[1];
    if(!priority) continue;
    const seats = line.match(/\b(\d+)\s*(?:seat|seats|pax)?\b/i)?.[1];
    const cabin = line.match(/\b(first|business|economy|premium|polaris|j|o|y)\b/i)?.[1];
    rows.push({ priority: priority.toUpperCase(), requestedSeats: Number(seats || 1), requestedCabin: cabin ? cabin.toUpperCase() : null, raw: line });
  }
  return rows;
}
function parseObservation(text, type){
  const cabin = parseCabinTable(text);
  const money = moneyValues(text);
  const standbyRows = parseStandbyRows(text);
  const parsed = {
    rawText: text || "",
    sourceType: type,
    boardingTotals: cabin,
    standbyRows,
    currentFare: money[0] || null,
    oOfferCash: /\bo\b|premium|premier/i.test(text || "") ? money[1] || null : null,
    jOfferCash: money[2] || null,
    upgradablePremiers: numberAfter(text, ["upgradable premiers", "upgradeable premiers", "upgrades", "upgrade list", "upgradable"]),
    revenueStandby: numberAfter(text, ["revenue standby", "rev standby"]),
    spaceAvailableStandby: numberAfter(text, ["space available standby", "space avail", "nonrev", "nrsa"]),
    totalStandby: numberAfter(text, ["total standby", "standby total", "standby list", "standby"]),
    availableSeats: numberAfter(text, ["available seats", "available"]),
  };
  if(standbyRows.length){
    parsed.totalStandby = parsed.totalStandby ?? standbyRows.reduce((s,r)=>s+r.requestedSeats,0);
  }
  return parsed;
}

function latestObservation(flight){ return [...(flight.observations || [])].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)).at(-1); }
function mergedSnapshot(flight){
  const merged = { available:{J:null,O:null,Y:null}, booked:{J:null,O:null,Y:null}, capacity:{J:null,O:null,Y:null}, standby:0, upgrade:0, fare:null, rawCount:0 };
  for(const o of (flight.observations || [])){
    merged.rawCount++;
    const p = o.parsed || {};
    for(const group of ["available","booked","capacity"]){
      for(const c of ["J","O","Y"]){
        const v = p.boardingTotals?.[group]?.[c];
        if(Number.isFinite(v)) merged[group][c] = v;
      }
    }
    if(Number.isFinite(p.totalStandby)) merged.standby = p.totalStandby;
    if(Number.isFinite(p.spaceAvailableStandby)) merged.standby = Math.max(merged.standby, p.spaceAvailableStandby);
    if(Number.isFinite(p.upgradablePremiers)) merged.upgrade = p.upgradablePremiers;
    if(Number.isFinite(p.currentFare)) merged.fare = p.currentFare;
  }
  return merged;
}
function hoursToDeparture(flight){
  if(!flight.departureTime) return null;
  return (new Date(flight.departureTime).getTime() - Date.now()) / 36e5;
}
function observationTrend(flight){
  const obs = (flight.observations || []).filter(o => o.parsed?.boardingTotals?.available || Number.isFinite(o.parsed?.totalStandby));
  if(obs.length < 2) return { yVelocity:0, jVelocity:0, fareVelocity:0, standbyVelocity:0, confidence:0.35 };
  const a = obs.at(-2), b = obs.at(-1);
  const dt = Math.max(1, (new Date(b.timestamp)-new Date(a.timestamp))/36e5);
  const avA = a.parsed.boardingTotals?.available || {}, avB = b.parsed.boardingTotals?.available || {};
  const yVelocity = ((avB.Y ?? 0) - (avA.Y ?? 0)) / dt;
  const jVelocity = ((avB.J ?? 0) - (avA.J ?? 0)) / dt;
  const standbyVelocity = ((b.parsed.totalStandby ?? 0) - (a.parsed.totalStandby ?? 0)) / dt;
  const fareVelocity = ((b.parsed.currentFare ?? 0) - (a.parsed.currentFare ?? 0)) / dt;
  return { yVelocity, jVelocity, standbyVelocity, fareVelocity, confidence: Math.min(.85, .35 + obs.length * .1) };
}
function fareCrossoverHours(flight){
  const snap = mergedSnapshot(flight);
  if(!flight.maxFare || !snap.fare) return null;
  if(snap.fare >= flight.maxFare) return 0;
  const trend = observationTrend(flight);
  const defaultSlope = Math.max(3, (snap.standby + snap.upgrade) * .35); // dollars/hour rough pressure proxy
  const slope = Math.max(defaultSlope, trend.fareVelocity || 0);
  if(slope <= 0) return null;
  const hours = (flight.maxFare - snap.fare) / slope;
  const htd = hoursToDeparture(flight);
  if(htd != null && hours > htd) return null;
  return Math.max(0, hours);
}
function evalHorizonHours(flight){
  const cross = fareCrossoverHours(flight);
  if(cross != null) return cross;
  const htd = hoursToDeparture(flight);
  return htd == null ? 120 : Math.max(0, htd);
}
function confidenceAt(flight, hours){
  const obsCount = (flight.observations || []).length;
  const trend = observationTrend(flight);
  const timeDecay = Math.exp(-Math.max(0,hours)/120);
  const dataBoost = Math.min(.35, obsCount * .08);
  const base = .35 + dataBoost + trend.confidence * .2;
  return clamp(base * (.45 + .55*timeDecay), .18, .92);
}
function projectSnapshot(flight, hours){
  const snap = mergedSnapshot(flight);
  const trend = observationTrend(flight);
  return {
    J: Math.max(0, (snap.available.J ?? 0) + trend.jVelocity * hours),
    O: Math.max(0, (snap.available.O ?? 0)),
    Y: Math.max(0, (snap.available.Y ?? 0) + trend.yVelocity * hours),
    standby: Math.max(0, snap.standby + trend.standbyVelocity * hours),
    upgrade: Math.max(0, snap.upgrade),
    fare: snap.fare ? Math.max(snap.fare, snap.fare + Math.max(0, trend.fareVelocity) * hours) : null
  };
}
function cabinProbability(projected, cabin, flight){
  const pressureY = projected.standby;
  const pressureJ = projected.upgrade + (flight.cabinLayout === "domestic2" ? projected.standby * .25 : projected.standby * .08);
  const oPressure = projected.upgrade * .55;
  const sigmoid = x => 1/(1+Math.exp(-x));
  if(cabin === "J") return sigmoid((projected.J - pressureJ) / 4.5);
  if(cabin === "O") return sigmoid((projected.O - oPressure) / 3.5);
  return sigmoid((projected.Y - pressureY) / 8.5);
}
function atLeastProbability(projected, minimum, flight){
  // Probability of meeting or exceeding minimum class; hierarchy J > O > Y.
  const pJ = cabinProbability(projected, "J", flight);
  const pO = cabinProbability(projected, "O", flight);
  const pY = cabinProbability(projected, "Y", flight);
  if(minimum === "J") return pJ;
  if(minimum === "O") return clamp(pJ + (1-pJ)*pO);
  return clamp(pJ + (1-pJ)*pO + (1-pJ)*(1-pO)*pY);
}
function stateColorFromDecision(action, minProb, confidence){
  if(action === "BUY NOW") return "red";
  if(minProb >= .92 && confidence >= .65) return "blue";
  if(minProb >= .75) return "green";
  if(minProb >= .55) return "yellow";
  if(minProb >= .35) return "orange";
  return "red";
}
function wordsForProb(p){
  if(p >= .9) return "Very High";
  if(p >= .75) return "High";
  if(p >= .58) return "Moderate";
  if(p >= .38) return "Low";
  return "Very Low";
}
function analyzeFlight(flight){
  const h = evalHorizonHours(flight);
  const cross = fareCrossoverHours(flight);
  const projected = projectSnapshot(flight, h);
  const desiredProb = cabinProbability(projected, flight.desiredClass || "J", flight);
  const minProb = atLeastProbability(projected, flight.minimumClass || "Y", flight);
  const conf = confidenceAt(flight, h);
  const thresholdReached = cross === 0;
  let action = "WAIT";
  if(thresholdReached && minProb < .72) action = "BUY NOW";
  else if(cross != null && minProb < .62) action = "BUY NOW";
  else if(cross != null && minProb < .78) action = "WATCH";
  else if(minProb < .55) action = "WATCH";
  const color = stateColorFromDecision(action, minProb, conf);
  const decisionPoint = cross == null ? "Not forecast before departure" : (cross === 0 ? "Reached" : `${Math.round(cross)}h until fare threshold`);
  let because;
  if(action === "BUY NOW") because = `Fare risk and minimum-cabin probability are no longer favorable at the decision point.`;
  else if(action === "WATCH") because = `Decision risk is building; minimum acceptable cabin is ${wordsForProb(minProb).toLowerCase()} at the decision point.`;
  else because = `Minimum acceptable cabin remains ${wordsForProb(minProb).toLowerCase()}, and fare risk does not justify buying yet.`;
  const changeMind = [];
  if(flight.maxFare) changeMind.push(`Fare reaches $${flight.maxFare}`);
  changeMind.push(`Minimum acceptable probability drops below 55%`);
  changeMind.push(`Standby demand grows faster than available Y`);
  changeMind.push(`Upgrade pressure increases while J/O remains constrained`);
  const evidence = [];
  evidence.push(`Evaluation time: ${decisionPoint}.`);
  evidence.push(`Desired ${flight.desiredClass || "J"}: ${pct(desiredProb)} (${wordsForProb(desiredProb)}).`);
  evidence.push(`Minimum ${flight.minimumClass || "Y"}: ${pct(minProb)} (${wordsForProb(minProb)}).`);
  evidence.push(`Forecast confidence: ${pct(conf)}.`);
  if(projected.fare) evidence.push(`Current/projected fare context: about $${Math.round(projected.fare)} at evaluation.`);
  evidence.push(`Projected inventory: J ${projected.J.toFixed(1)}, O ${projected.O.toFixed(1)}, Y ${projected.Y.toFixed(1)}, standby ${projected.standby.toFixed(1)}.`);
  return { h, cross, projected, desiredProb, minProb, conf, action, color, decisionPoint, because, evidence, changeMind };
}
function colorVar(color){ return {blue:"var(--blue)",green:"var(--green)",yellow:"var(--yellow)",orange:"var(--orange)",red:"var(--red)",black:"#333"}[color] || "var(--green)"; }

function render(){ renderQueue(); renderFlights(); save(); }
function renderQueue(){
  const q = $("decisionQueue");
  if(!state.flights.length){ q.innerHTML = `<div class="no-data">No flights yet. Add one tracked flight to start.</div>`; return; }
  const ranked = [...state.flights].map(f=>({f,a:analyzeFlight(f)})).sort((x,y)=>{
    const order = {"BUY NOW":0,"WATCH":1,"WAIT":2}; return order[x.a.action]-order[y.a.action] || x.a.minProb-y.a.minProb;
  }).slice(0,3);
  q.innerHTML = `<div class="panel-title">Decision Queue</div>` + ranked.map(({f,a})=>`
    <div class="queue-card" style="--state:${colorVar(a.color)}">
      <div class="queue-left"><span class="dot"></span><div><div class="queue-action">${a.action}</div><div class="tiny">${f.flightNumber} ${f.origin||""}→${f.destination||""}</div></div></div>
      <div class="tiny">${a.decisionPoint}</div>
    </div>`).join("");
}
function renderFlights(){
  const list = $("flightList");
  list.innerHTML = state.flights.map(f => {
    const a = analyzeFlight(f);
    const obs = latestObservation(f);
    const dep = f.departureTime ? new Date(f.departureTime).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "Departure not set";
    const route = `${f.origin || "???"} → ${f.destination || "???"}`;
    const open = f.open ? "open" : "";
    return `<article class="flight-card ${open}" style="--state:${colorVar(a.color)}" data-id="${f.id}">
      <div class="flight-main" data-toggle="${f.id}">
        <div class="topline"><div><div class="flight-num">${f.flightNumber || "Flight"}</div><div class="route">${route} • ${dep}</div></div><div class="confidence">${pct(a.conf)}</div></div>
        <div class="state-line"><span class="dot"></span><div><div class="action">${a.action}</div><div class="tiny">Confidence ${pct(a.conf)}</div></div></div>
        <div class="because"><strong>Because:</strong> ${a.because}</div>
        <div class="metrics">
          <div class="metric"><div class="label">Decision Point</div><div class="value">${a.cross == null ? "None" : a.cross===0 ? "Now" : Math.round(a.cross)+"h"}</div><div class="tiny">${a.decisionPoint}</div></div>
          <div class="metric"><div class="label">Desired ${f.desiredClass||"J"}</div><div class="value">${wordsForProb(a.desiredProb)}</div><div class="tiny">${pct(a.desiredProb)} at decision point</div></div>
          <div class="metric"><div class="label">Minimum ${f.minimumClass||"Y"}</div><div class="value">${wordsForProb(a.minProb)}</div><div class="tiny">${pct(a.minProb)} at decision point</div></div>
          <div class="metric"><div class="label">Last Reading</div><div class="value">${obs ? new Date(obs.timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "None"}</div><div class="tiny">${(f.observations||[]).length} observations saved</div></div>
        </div>
      </div>
      <div class="detail">
        <div class="card-actions">
          <button class="primary" data-addobs="${f.id}">+ Observation</button>
          <button data-why="${f.id}">Explain</button>
          <button data-delete="${f.id}" class="danger">Delete</button>
        </div>
        <div class="detail-grid">
          <section class="panel"><div class="panel-title">What would change my mind?</div><ul class="evidence-list">${a.changeMind.map(x=>`<li>${x}</li>`).join("")}</ul></section>
          <section class="panel"><div class="panel-title">Evidence</div><ul class="evidence-list">${a.evidence.map(x=>`<li>${x}</li>`).join("")}</ul></section>
          <section class="panel"><div class="panel-title">Observation Timeline</div><div class="timeline">${(f.observations||[]).slice().reverse().map(o=>`<div class="timeline-item"><strong>${o.sourceType}</strong> <span class="tiny">${new Date(o.timestamp).toLocaleString()}</span><br><span class="tiny">${summaryParsed(o.parsed)}</span></div>`).join("") || `<div class="tiny">No readings yet.</div>`}</div></section>
        </div>
      </div>
    </article>`;
  }).join("");
}
function summaryParsed(p){
  if(!p) return "No parsed data.";
  const av = p.boardingTotals?.available;
  const bits = [];
  if(av) bits.push(`Avail J/O/Y ${av.J ?? "?"}/${av.O ?? "?"}/${av.Y ?? "?"}`);
  if(Number.isFinite(p.totalStandby)) bits.push(`Standby ${p.totalStandby}`);
  if(Number.isFinite(p.upgradablePremiers)) bits.push(`Upgradable ${p.upgradablePremiers}`);
  if(Number.isFinite(p.currentFare)) bits.push(`Fare $${p.currentFare}`);
  return bits.join(" • ") || "Saved note.";
}

function addFlightFromForm(){
  const f = {
    id: uid(), flightNumber: $("flightNumber").value.trim().toUpperCase(), date: $("flightDate").value,
    origin: $("origin").value.trim().toUpperCase(), destination: $("destination").value.trim().toUpperCase(),
    departureTime: $("departureTime").value, aircraft: $("aircraft").value.trim(), cabinLayout: $("cabinLayout").value,
    travelMode: $("travelMode").value, desiredClass: $("desiredClass").value, minimumClass: $("minimumClass").value,
    maxFare: Number($("maxFare").value || 0), tripName: $("tripName").value.trim(), observations: [], open: true
  };
  state.flights.push(f); render();
}
function openObservation(id){
  activeFlightId = id;
  const f = state.flights.find(x=>x.id===id);
  $("obsFlightName").textContent = `${f.flightNumber} ${f.origin||""} → ${f.destination||""}`;
  $("obsText").value = ""; $("parsePreview").textContent = ""; $("ocrStatus").textContent = ""; $("obsImage").value = "";
  $("obsDialog").showModal();
}
function saveObservation(){
  const f = state.flights.find(x=>x.id===activeFlightId); if(!f) return;
  const text = $("obsText").value;
  const type = $("sourceType").value;
  const parsed = parseObservation(text, type);
  f.observations.push({ id: uid(), timestamp: nowIso(), sourceType: type, text, parsed });
  f.open = true;
  render();
}
function showWhy(id){
  const f = state.flights.find(x=>x.id===id); const a = analyzeFlight(f);
  $("whyContent").innerHTML = `
    <div class="state-line"><span class="dot" style="background:${colorVar(a.color)};box-shadow:0 0 22px ${colorVar(a.color)}"></span><div><div class="action">${a.action}</div><div class="tiny">Recommendation confidence ${pct(a.conf)}</div></div></div>
    <p>${a.because}</p>
    <div class="panel-title">Why</div><ul class="evidence-list">${a.evidence.map(x=>`<li>${x}</li>`).join("")}</ul>
    <div class="panel-title">What would change my mind?</div><ul class="evidence-list">${a.changeMind.map(x=>`<li>${x}</li>`).join("")}</ul>`;
  $("whyDialog").showModal();
}
function seedDemo(){
  state.flights = [{ id:uid(), flightNumber:"UA1734", origin:"SAN", destination:"IAD", departureTime:new Date(Date.now()+72*36e5).toISOString().slice(0,16), aircraft:"737-900", cabinLayout:"domestic2", travelMode:"NRSA", desiredClass:"J", minimumClass:"Y", maxFare:650, observations:[], open:true }];
  const f = state.flights[0];
  for(const t of [
    "Boarding Totals\nAuthorized 16 0 151\nCapacity 16 0 150\nBooked 16 0 142\nUpgradable Premiers 13\nAvailable 0 0 8\nRevenue Standby 0\nSpace Available Standby 0\n$420",
    "Standby List\nAvailable seats 23\nTotal standby 3\nSA0V 2 First\nSA1P 1 Economy\n$445"
  ]) f.observations.push({id:uid(),timestamp:nowIso(),sourceType:"demo",text:t,parsed:parseObservation(t,"demo")});
  render();
}

function wire(){
  $("addFlightBtn").onclick = () => { $("flightForm").reset(); $("flightDialog").showModal(); };
  $("saveFlight").onclick = (e) => { e.preventDefault(); addFlightFromForm(); $("flightDialog").close(); };
  $("saveObs").onclick = (e) => { e.preventDefault(); saveObservation(); $("obsDialog").close(); };
  $("obsText").addEventListener("input", () => { const p = parseObservation($("obsText").value,$("sourceType").value); $("parsePreview").textContent = JSON.stringify(p,null,2); });
  $("ocrBtn").onclick = async () => {
    const file = $("obsImage").files[0]; if(!file) return alert("Choose a screenshot first.");
    if(!window.Tesseract) return alert("OCR library is not loaded yet. Try again in a moment.");
    $("ocrStatus").textContent = "Reading screenshot…";
    const result = await Tesseract.recognize(file, "eng", { logger:m=>{ if(m.status) $("ocrStatus").textContent = `${m.status} ${m.progress ? Math.round(m.progress*100)+"%" : ""}`; }});
    $("obsText").value = result.data.text;
    $("obsText").dispatchEvent(new Event("input"));
    $("ocrStatus").textContent = "OCR complete. Review before saving.";
  };
  $("exportBtn").onclick = () => { $("backupBox").value = JSON.stringify(state,null,2); };
  $("importBtn").onclick = () => { try{ state = JSON.parse($("backupBox").value); render(); } catch { alert("Invalid JSON"); }};
  $("clearBtn").onclick = () => { if(confirm("Clear all Vector data on this device?")){ state={flights:[]}; render(); }};
  $("demoBtn").onclick = seedDemo;
  document.body.addEventListener("click", e => {
    const toggle = e.target.closest("[data-toggle]"); if(toggle){ const f=state.flights.find(x=>x.id===toggle.dataset.toggle); f.open=!f.open; render(); return; }
    const add = e.target.closest("[data-addobs]"); if(add){ openObservation(add.dataset.addobs); return; }
    const why = e.target.closest("[data-why]"); if(why){ showWhy(why.dataset.why); return; }
    const del = e.target.closest("[data-delete]"); if(del){ if(confirm("Delete this tracked flight?")){ state.flights=state.flights.filter(f=>f.id!==del.dataset.delete); render(); } }
  });
}

load(); wire(); render();
