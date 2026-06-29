const STORE_KEY = "vector_decision_cockpit_v04";
let state = { flights: [], settings: { aeroApiKey: "" } };
let activeFlightId = null;

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const pct = (n) => `${Math.round(clamp(n) * 100)}%`;
const nowIso = () => new Date().toISOString();

const minutesBetween = (a,b) => {
  if(!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if(!Number.isFinite(ms)) return null;
  return Math.round(ms/60000);
};
const toLocalInputValue = (isoLike) => {
  if(!isoLike) return "";
  const d = new Date(isoLike);
  if(!Number.isFinite(d.getTime())) return "";
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function getDeep(obj, paths){
  for(const path of paths){
    const val = path.split('.').reduce((o,k)=>o && o[k], obj);
    if(val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}
function aircraftLabel(ac){
  if(!ac) return "";
  if(typeof ac === "string") return ac;
  return ac.model || ac.shortName || ac.reg || ac.icaoCode || ac.iataCode || ac.type || ac.name || "";
}

const AIRCRAFT_SEAT_CONFIGS = [
  { keys:["737-900","739","B739"], layout:"domestic2", J:20, O:0, Y:159, label:"737-900 typical United 20F/159Y" },
  { keys:["737-900ER","739ER"], layout:"domestic2", J:20, O:0, Y:159, label:"737-900ER typical United 20F/159Y" },
  { keys:["737-800","738","B738"], layout:"domestic2", J:16, O:0, Y:150, label:"737-800 typical United 16F/150Y" },
  { keys:["737 MAX 8","737-8","7M8","B38M"], layout:"domestic2", J:16, O:0, Y:150, label:"737 MAX 8 typical United 16F/150Y" },
  { keys:["737 MAX 9","737-9","7M9","B39M"], layout:"domestic2", J:20, O:0, Y:159, label:"737 MAX 9 typical United 20F/159Y" },
  { keys:["A319","319"], layout:"domestic2", J:12, O:0, Y:114, label:"A319 typical United 12F/114Y" },
  { keys:["A320","320"], layout:"domestic2", J:12, O:0, Y:138, label:"A320 typical United 12F/138Y" },
  { keys:["757-200","752"], layout:"domestic2", J:16, O:0, Y:160, label:"757-200 domestic typical 16F/160Y" },
  { keys:["757-300","753"], layout:"domestic2", J:24, O:0, Y:210, label:"757-300 typical United 24F/210Y" },
  { keys:["767-300","763"], layout:"threeClass", J:30, O:46, Y:138, label:"767-300 high-J / Premium Plus estimate" },
  { keys:["767-400","764"], layout:"threeClass", J:34, O:24, Y:201, label:"767-400 estimate" },
  { keys:["777-200","772"], layout:"threeClass", J:50, O:24, Y:242, label:"777-200 estimate" },
  { keys:["777-300","77W","777-300ER"], layout:"threeClass", J:60, O:24, Y:266, label:"777-300ER estimate" },
  { keys:["787-8","788"], layout:"threeClass", J:28, O:21, Y:194, label:"787-8 estimate" },
  { keys:["787-9","789"], layout:"threeClass", J:48, O:21, Y:188, label:"787-9 estimate" },
  { keys:["787-10","78J"], layout:"threeClass", J:44, O:21, Y:253, label:"787-10 estimate" },
];
function inferSeatConfig(aircraft){
  const a = String(aircraft||"").toUpperCase().replace(/[–—]/g,"-");
  if(!a) return null;
  return AIRCRAFT_SEAT_CONFIGS.find(cfg => cfg.keys.some(k => a.includes(String(k).toUpperCase())) ) || null;
}
function applySeatConfigFromAircraft(force=false){
  const cfg = inferSeatConfig($("aircraft")?.value);
  if(!cfg){ if($("capacityStatus")) $("capacityStatus").textContent = "Seat counts will autofill from aircraft type when recognized. You can override them."; return; }
  if(force || !$("capacityJ").value) $("capacityJ").value = cfg.J;
  if(force || !$("capacityO").value) $("capacityO").value = cfg.O;
  if(force || !$("capacityY").value) $("capacityY").value = cfg.Y;
  if(force || !$("cabinLayout").value) $("cabinLayout").value = cfg.layout;
  if($("capacityStatus")) $("capacityStatus").textContent = `Autofilled ${cfg.label}. Verify against Boarding Totals when available.`;
}

function normalizeFlightNumberForLookup(v){ return (v||"").trim().toUpperCase().replace(/\s+/g,""); }
function bestAeroFlight(data, requestedNumber){
  const arr = Array.isArray(data) ? data : (data.items || data.flights || data.data || []);
  if(!arr.length) return null;
  const req = normalizeFlightNumberForLookup(requestedNumber);
  return arr.find(x => normalizeFlightNumberForLookup(x.number || x.flight?.iata || x.flightNumber) === req) || arr[0];
}
function applyFlightLookupResult(raw){
  const depAirport = getDeep(raw,["departure.airport.iata","departure.airport.iataCode","departure.airport.code.iata","departure.airportCode","departure.iata","departureAirport.iata"]);
  const arrAirport = getDeep(raw,["arrival.airport.iata","arrival.airport.iataCode","arrival.airport.code.iata","arrival.airportCode","arrival.iata","arrivalAirport.iata"]);
  const depTime = getDeep(raw,["departure.scheduledTime.local","departure.scheduledTime.utc","departure.scheduled.local","departure.scheduled.utc","departure.time.local","departure.time.utc","departure.scheduledTime"]);
  const arrTime = getDeep(raw,["arrival.scheduledTime.local","arrival.scheduledTime.utc","arrival.scheduled.local","arrival.scheduled.utc","arrival.time.local","arrival.time.utc","arrival.scheduledTime"]);
  const ac = aircraftLabel(raw.aircraft || raw.airplane || raw.equipment);
  if(depAirport) $("origin").value = String(depAirport).toUpperCase();
  if(arrAirport) $("destination").value = String(arrAirport).toUpperCase();
  if(depTime) $("departureTime").value = toLocalInputValue(depTime);
  if(ac){ $("aircraft").value = ac; applySeatConfigFromAircraft(true); }
  const mins = minutesBetween(depTime, arrTime);
  $("lookupStatus").textContent = `Autofilled ${depAirport||"?"} → ${arrAirport||"?"}${mins ? ` • ${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m` : ""}${ac ? ` • ${ac}` : ""}`;
}
async function lookupFlightDetails(){
  const key = (state.settings?.aeroApiKey || $("aeroKey")?.value || "").trim();
  const num = normalizeFlightNumberForLookup($("flightNumber").value);
  const date = $("flightDate").value;
  if(!num || !date){ $("lookupStatus").textContent = "Enter a flight number and date first."; return; }
  if(!key){ $("lookupStatus").textContent = "Enter your AeroDataBox API.Market key in Backup & restore first, then try Lookup Flight."; return; }
  state.settings.aeroApiKey = key; save();
  $("lookupStatus").textContent = "Looking up flight details…";
  try{
    const url = `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/${encodeURIComponent(num)}/${date}`;
    const res = await fetch(url, { headers: { "Accept":"application/json", "x-magicapi-key": key }});
    if(!res.ok){ throw new Error(`Lookup failed (${res.status})`); }
    const data = await res.json();
    const flight = bestAeroFlight(data, num);
    if(!flight){ $("lookupStatus").textContent = "No matching flight found for that number/date. You can still enter details manually."; return; }
    applyFlightLookupResult(flight);
  }catch(err){
    $("lookupStatus").textContent = `${err.message}. Manual entry still works.`;
  }
}

function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load(){
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || { flights: [], settings: { aeroApiKey: "" } }; }
  catch { state = { flights: [], settings: { aeroApiKey: "" } }; }
  state.flights = state.flights || [];
  state.settings = state.settings || { aeroApiKey: "" };
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
  const cap = flight.capacity || {};
  const merged = { available:{J:null,O:null,Y:null}, booked:{J:null,O:null,Y:null}, capacity:{J:cap.J||null,O:cap.O||0,Y:cap.Y||null}, standby:0, upgrade:0, fare:null, rawCount:0 };
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
  // If only aircraft capacity is known and no available value has been read yet, assume unknown rather than full availability.
  // Use capacity only as context for pressure/seat-map scaling, not as a claim of open seats.
  for(const c of ["J","O","Y"]){
    if(!Number.isFinite(merged.capacity[c]) && Number.isFinite(cap[c])) merged.capacity[c] = cap[c];
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

function paidFareClassScore(fareClass){
  const order = ["Y","B","M","E","U","H","Q","V","W","S","T","L","K","G","N"];
  const f = String(fareClass||"").trim().toUpperCase();
  const idx = order.indexOf(f);
  if(idx < 0) return 0.35;
  if(f === "N") return 0; // Basic Economy: treat as not upgrade-eligible unless manually overridden later.
  return clamp(1 - idx/(order.length-1), .08, 1);
}
function premierScore(status){
  return ({none:0, silver:.18, gold:.34, platinum:.52, "1k":.75, gs:1}[String(status||"none").toLowerCase()] ?? 0);
}
function instrumentScore(instrument){
  return ({none:0, cash:.9, pluspoints:.82, miles:.78, cpu:.38}[String(instrument||"none").toLowerCase()] ?? 0);
}
function upgradePriorityScore(flight){
  const f = paidFareClassScore(flight.paidFareClass);
  const p = premierScore(flight.premierStatus);
  const i = instrumentScore(flight.upgradeInstrument);
  const modeBoost = flight.travelMode === "Upgrade" ? .1 : flight.travelMode === "Paid" ? .05 : 0;
  const positionPenalty = flight.upgradePosition ? Math.min(.35, flight.upgradePosition * .018) : 0;
  const paidSeatBoost = flight.ticketedSeatClass === "O" ? .06 : flight.ticketedSeatClass === "J" ? .12 : 0;
  if(String(flight.paidFareClass||"").toUpperCase() === "N") return 0;
  return clamp((i*.42) + (p*.33) + (f*.20) + modeBoost + paidSeatBoost - positionPenalty, 0, 1);
}
function effectiveUpgradePressure(projected, flight){
  const myPriority = upgradePriorityScore(flight);
  // Higher user priority means fewer listed upgrade requests are effectively ahead of the user.
  return Math.max(0, projected.upgrade * (1 - myPriority*.55));
}

function cabinProbability(projected, cabin, flight){
  const myPriority = upgradePriorityScore(flight);
  const upgradePressure = effectiveUpgradePressure(projected, flight);
  const party = Math.max(1, Number(flight.partySize || 1));
  const standbyPosPenalty = flight.standbyPosition ? Math.min(12, Math.max(0, flight.standbyPosition - 1) * 0.9) : 0;
  const pressureY = projected.standby + Math.max(0, party - 1) * 1.7 + standbyPosPenalty;
  const pressureJ = upgradePressure + (flight.cabinLayout === "domestic2" ? projected.standby * .25 : projected.standby * .08) + Math.max(0, party - 1) * .9;
  const oPressure = upgradePressure * .55;
  const sigmoid = x => 1/(1+Math.exp(-x));
  if(String(flight.paidFareClass||"").toUpperCase() === "N" && (cabin === "J" || cabin === "O")) return 0;
  if(cabin === "J"){
    const jDirect = sigmoid((projected.J - pressureJ + myPriority*2.8) / 4.5);
    // On three-class aircraft, J is commonly constrained by O/upgrade chain availability; model it as conditional when O exists.
    if(flight.cabinLayout === "threeClass" && (flight.capacity?.O || projected.O) > 0){
      const oGate = sigmoid((projected.O - oPressure + myPriority*2.0) / 3.5);
      return clamp(jDirect * (.55 + .45*oGate));
    }
    return jDirect;
  }
  if(cabin === "O") return sigmoid((projected.O - oPressure + myPriority*2.0) / 3.5);
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
function totalUpgradeCost(flight, cabin){
  const cash = Number(flight?.fareEconomics?.[cabin]?.upgradeCash || 0);
  const miles = Number(flight?.fareEconomics?.[cabin]?.upgradeMiles || 0);
  const mv = Number(flight.milesValue || .012);
  return cash + miles * mv;
}
function criticalityPenalty(flight){
  const ctx = String(flight.tripContext||"").toLowerCase();
  const style = String(flight.decisionStyle||"balanced").toLowerCase();
  let p = 0;
  if(ctx === "business" || ctx === "commute" || ctx === "positioning") p += .07;
  if(ctx === "family") p += .035;
  if(style === "conservative") p += .08;
  if(style === "aggressive") p -= .07;
  return p;
}
function farePressureFromEconomics(flight){
  const econ = flight.fareEconomics || {};
  const maxPublic = Math.max(Number(econ.J?.publicFare||0), Number(econ.O?.publicFare||0), Number(econ.Y?.publicFare||0));
  const invested = Number(flight.costInvested || 0);
  if(!maxPublic && !invested) return 0;
  return clamp(((maxPublic || invested) - invested) / Math.max(1, maxPublic || invested) * .12, 0, .12);
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
  const riskBias = criticalityPenalty(flight) + farePressureFromEconomics(flight);
  const effectiveMinProb = clamp(minProb - riskBias, 0, 1);
  if(thresholdReached && effectiveMinProb < .72) action = "BUY NOW";
  else if(cross != null && effectiveMinProb < .62) action = "BUY NOW";
  else if(cross != null && effectiveMinProb < .78) action = "WATCH";
  else if(effectiveMinProb < .55) action = "WATCH";
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
  if(String(flight.paidFareClass||"").toUpperCase()==="N") changeMind.push(`Paid fare class changes from Basic Economy / N to an upgrade-eligible fare`);
  if(flight.partySize && Number(flight.partySize)>1) changeMind.push(`Party size drops or additional seats open together`);
  if(flight.upgradePosition) changeMind.push(`Upgrade position improves or upgrade list shrinks materially`);
  const evidence = [];
  evidence.push(`Evaluation time: ${decisionPoint}.`);
  evidence.push(`Desired ${flight.desiredClass || "J"}: ${pct(desiredProb)} (${wordsForProb(desiredProb)}).`);
  evidence.push(`Minimum ${flight.minimumClass || "Y"}: ${pct(minProb)} (${wordsForProb(minProb)}).`);
  evidence.push(`Forecast confidence: ${pct(conf)}.`);
  if(flight.aircraft) evidence.push(`Aircraft/capacity context: ${flight.aircraft}; seats J/O/Y ${flight.capacity?.J ?? "?"}/${flight.capacity?.O ?? "?"}/${flight.capacity?.Y ?? "?"}.`);
  if(flight.travelMode !== "NRSA" || flight.upgradeInstrument !== "none") evidence.push(`Upgrade context: ${flight.travelMode}; instrument ${flight.upgradeInstrument || "none"}; fare class ${flight.paidFareClass || "unknown"}; ticketed cabin ${flight.ticketedSeatClass || "unknown"}; priority factor ${pct(upgradePriorityScore(flight))}.`);
  if(flight.partySize && Number(flight.partySize)>1) evidence.push(`Party size ${flight.partySize}: all seats must clear together, reducing minimum-cabin probability.`);
  if(flight.standbyPosition) evidence.push(`Your standby position ${flight.standbyPosition} adds queue pressure to minimum-cabin clearance.`);
  if(flight.tripContext) evidence.push(`Trip context ${flight.tripContext} with ${flight.decisionStyle || "balanced"} style changes how early Janus recommends buying.`);
  if(totalUpgradeCost(flight,"J")) evidence.push(`J/F upgrade economic cost estimate: $${Math.round(totalUpgradeCost(flight,"J"))} using miles value ${flight.milesValue || .012}/mile.`);
  if(totalUpgradeCost(flight,"O")) evidence.push(`O upgrade economic cost estimate: $${Math.round(totalUpgradeCost(flight,"O"))} using miles value ${flight.milesValue || .012}/mile.`);
  if(projected.fare) evidence.push(`Current/projected fare context: about $${Math.round(projected.fare)} at evaluation.`);
  evidence.push(`Projected inventory: J ${projected.J.toFixed(1)}, O ${projected.O.toFixed(1)}, Y ${projected.Y.toFixed(1)}, standby ${projected.standby.toFixed(1)}, effective upgrade pressure ${effectiveUpgradePressure(projected, flight).toFixed(1)}.`);
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

function nval(id){ return Number($(id)?.value || 0); }
function sval(id){ return ($(id)?.value || "").trim(); }
function addFlightFromForm(){
  const desired = sval("desiredClass") || sval("minimumClass") || "Y";
  const f = {
    id: uid(), flightNumber: sval("flightNumber").toUpperCase(), date: sval("flightDate"),
    origin: sval("origin").toUpperCase(), destination: sval("destination").toUpperCase(),
    departureTime: sval("departureTime"), aircraft: sval("aircraft"), cabinLayout: sval("cabinLayout"),
    durationMinutes: null,
    capacity:{ J:nval("capacityJ"), O:nval("capacityO"), Y:nval("capacityY") },
    travelMode: sval("travelMode"), paidFareClass: sval("paidFareClass").toUpperCase(), ticketedSeatClass: sval("ticketedSeatClass"),
    premierStatus: sval("premierStatus"), upgradeInstrument: sval("upgradeInstrument"), upgradePosition: nval("upgradePosition"), standbyPosition: nval("standbyPosition"),
    partySize: Math.max(1, nval("partySize") || 1), tripId: sval("tripId"), tripContext: sval("tripContext"), decisionStyle: sval("decisionStyle") || "balanced", flightNotes: sval("flightNotes"),
    costInvested: nval("costInvested"), milesValue: nval("milesValue") || .012,
    fareEconomics:{
      J:{ publicFare:nval("jPublicFare"), employeeFare:nval("jEmployeeFare"), upgradeCash:nval("jUpgradeCash"), upgradeMiles:nval("jUpgradeMiles"), upgradeSuccessful: !!$("jUpgradeSuccessful")?.checked },
      O:{ publicFare:nval("oPublicFare"), employeeFare:nval("oEmployeeFare"), upgradeCash:nval("oUpgradeCash"), upgradeMiles:nval("oUpgradeMiles"), upgradeSuccessful: !!$("oUpgradeSuccessful")?.checked },
      Y:{ publicFare:nval("yPublicFare"), employeeFare:nval("yEmployeeFare") }
    },
    desiredClass: desired, minimumClass: sval("minimumClass") || "Y",
    maxFare: nval("maxFare"), tripName: sval("tripName"), observations: [], open: true
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
  state.flights = [{ id:uid(), flightNumber:"UA1734", origin:"SAN", destination:"IAD", departureTime:new Date(Date.now()+72*36e5).toISOString().slice(0,16), aircraft:"737-900", cabinLayout:"domestic2", capacity:{J:20,O:0,Y:159}, paidFareClass:"", premierStatus:"none", upgradeInstrument:"none", upgradePosition:0, standbyPosition:0, partySize:1, tripContext:"Leisure", decisionStyle:"balanced", ticketedSeatClass:"", costInvested:0, milesValue:.012, fareEconomics:{J:{},O:{},Y:{}}, travelMode:"NRSA", desiredClass:"J", minimumClass:"Y", maxFare:650, observations:[], open:true }];
  const f = state.flights[0];
  for(const t of [
    "Boarding Totals\nAuthorized 16 0 151\nCapacity 16 0 150\nBooked 16 0 142\nUpgradable Premiers 13\nAvailable 0 0 8\nRevenue Standby 0\nSpace Available Standby 0\n$420",
    "Standby List\nAvailable seats 23\nTotal standby 3\nSA0V 2 First\nSA1P 1 Economy\n$445"
  ]) f.observations.push({id:uid(),timestamp:nowIso(),sourceType:"demo",text:t,parsed:parseObservation(t,"demo")});
  render();
}

function wire(){
  $("addFlightBtn").onclick = () => { $("flightForm").reset(); $("lookupStatus").textContent = "Optional: autofill route, times, duration, aircraft."; $("flightDialog").showModal(); };
  $("lookupFlightBtn").onclick = lookupFlightDetails;
  $("aircraft").addEventListener("change", () => applySeatConfigFromAircraft(false));
  $("aeroKey").value = state.settings?.aeroApiKey || "";
  $("aeroKey").addEventListener("change", () => { state.settings.aeroApiKey = $("aeroKey").value.trim(); save(); });
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
  $("importBtn").onclick = () => { try{ state = JSON.parse($("backupBox").value); state.settings = state.settings || { aeroApiKey: "" }; $("aeroKey").value = state.settings.aeroApiKey || ""; render(); } catch { alert("Invalid JSON"); }};
  $("clearBtn").onclick = () => { if(confirm("Clear all Vector data on this device?")){ state={flights:[], settings: state.settings || { aeroApiKey: "" }}; render(); }};
  $("demoBtn").onclick = seedDemo;
  document.body.addEventListener("click", e => {
    const toggle = e.target.closest("[data-toggle]"); if(toggle){ const f=state.flights.find(x=>x.id===toggle.dataset.toggle); f.open=!f.open; render(); return; }
    const add = e.target.closest("[data-addobs]"); if(add){ openObservation(add.dataset.addobs); return; }
    const why = e.target.closest("[data-why]"); if(why){ showWhy(why.dataset.why); return; }
    const del = e.target.closest("[data-delete]"); if(del){ if(confirm("Delete this tracked flight?")){ state.flights=state.flights.filter(f=>f.id!==del.dataset.delete); render(); } }
  });
}

load(); wire(); render();
