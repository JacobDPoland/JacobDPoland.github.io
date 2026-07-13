"use strict";

/* ====================================================================
   Constants & state
==================================================================== */
const CENTRAL = "America/Chicago";
const LS = {
  dep: "gapwatch.deploymentId",
  key: "gapwatch.apiKey",
  remember: "gapwatch.remember",
  since: "gapwatch.since",
  sinceRemember: "gapwatch.sinceRemember"
};

const state = {
  deploymentId: "",
  apiKey: "",
  lastData: null,   // raw endpoint payload
  lastGaps: null,   // computed gap rows
  runStamp: "",     // filename-safe Central timestamp
  workerCount: 1
};

/* ====================================================================
   Central-time helpers (mirror the Python script's America/Chicago logic)
==================================================================== */
function centralParts(date){
  const dtf = new Intl.DateTimeFormat("en-US",{
    timeZone:CENTRAL, hour12:false,
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit"
  });
  const m = {};
  for(const p of dtf.formatToParts(date)) m[p.type]=p.value;
  if(m.hour === "24") m.hour = "00";
  return {y:m.year, mo:m.month, d:m.day, h:m.hour, mi:m.minute, s:m.second};
}

// "MM/DD/YYYY HH:MM:SS" in Central — matches Python strftime output.
function formatCentral(date){
  const p = centralParts(date);
  return `${p.mo}/${p.d}/${p.y} ${p.h}:${p.mi}:${p.s}`;
}

function centralOffsetMs(utcMs){
  const p = centralParts(new Date(utcMs));
  const asUTC = Date.UTC(+p.y, +p.mo-1, +p.d, +p.h, +p.mi, +p.s);
  return asUTC - utcMs;
}

// Interpret a wall-clock time as Central and return a real instant (handles DST).
function centralWallToInstant(y,mo,d,h,mi,s){
  const guess = Date.UTC(y,mo-1,d,h,mi,s);
  const off1 = centralOffsetMs(guess);
  let inst = guess - off1;
  const off2 = centralOffsetMs(inst);
  if(off2 !== off1) inst = guess - off2;
  return new Date(inst);
}

// Row "Timestamp" arrives as ISO 8601 UTC. Treat zone-less values as UTC.
function parseRowTimestamp(value){
  let v = String(value).trim();
  const hasZone = /([zZ]|[+\-]\d{2}:?\d{2})$/.test(v);
  if(!hasZone) v += "Z";
  const d = new Date(v);
  if(isNaN(d.getTime())) throw new Error("unparseable timestamp");
  return d;
}

// "YYYYMMDDTHHMMSS_CT" for filenames.
function runStampCentral(date){
  const p = centralParts(date);
  return `${p.y}${p.mo}${p.d}T${p.h}${p.mi}${p.s}_CT`;
}

/* ====================================================================
   Gap detection (port of find_gaps)
==================================================================== */
function estimateMissing(minutes, expectedInterval){
  return Math.max(0, Math.round(minutes / expectedInterval) - 1);
}
const round1 = m => Math.round(m * 10) / 10;

function isTrackedTab(name){
  const lower = name.toLowerCase().trim();
  if(lower === "controller") return true;
  const m = lower.match(/^worker\s+(\d+)$/);
  if(!m) return false;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= state.workerCount;
}

function findGaps(data, now, sinceDt, thresholdMin, expectedMin){
  const thrMs = thresholdMin * 60000;
  const gaps = [];
  const sheets = data.sheets || {};

  for(const [name, sheet] of Object.entries(sheets)){
    if(!isTrackedTab(name)) continue;
    const rows = sheet.rows || [];
    const ts = [];
    for(const row of rows){
      const t = row.Timestamp;
      if(!t) continue;
      try{ ts.push(parseRowTimestamp(t)); }catch(e){ /* skip */ }
    }
    ts.sort((a,b)=>a-b);

    // historical gaps between consecutive readings
    for(let i=1;i<ts.length;i++){
      const deltaMs = ts[i]-ts[i-1];
      if(deltaMs >= thrMs){
        const minutes = deltaMs/60000;
        gaps.push({
          sensor:name, _start:ts[i-1],
          gap_start:formatCentral(ts[i-1]), gap_end:formatCentral(ts[i]),
          duration_minutes:round1(minutes),
          estimated_missing_readings:estimateMissing(minutes,expectedMin),
          ongoing:"no"
        });
      }
    }

    // ongoing downtime: latest reading -> now (or whole window if no rows)
    if(ts.length){
      const last = ts[ts.length-1];
      const deltaMs = now - last;
      if(deltaMs >= thrMs){
        const minutes = deltaMs/60000;
        gaps.push({
          sensor:name, _start:last,
          gap_start:formatCentral(last), gap_end:formatCentral(now),
          duration_minutes:round1(minutes),
          estimated_missing_readings:estimateMissing(minutes,expectedMin),
          ongoing:"yes"
        });
      }
    } else if(sinceDt){
      const deltaMs = now - sinceDt;
      if(deltaMs >= thrMs){
        const minutes = deltaMs/60000;
        gaps.push({
          sensor:name, _start:sinceDt,
          gap_start:formatCentral(sinceDt), gap_end:formatCentral(now),
          duration_minutes:round1(minutes),
          estimated_missing_readings:estimateMissing(minutes,expectedMin),
          ongoing:"yes"
        });
      }
    }
  }

  gaps.sort((a,b)=>a._start - b._start);
  return gaps;
}

/* ====================================================================
   CSV building (port of save_csvs / save_gap_csv)
==================================================================== */
function csvCell(v){
  if(v===null||v===undefined) v="";
  v = String(v);
  if(/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
  return v;
}
function toCsv(headers, rows){
  const out = [headers.map(csvCell).join(",")];
  for(const r of rows) out.push(headers.map(h=>csvCell(r[h])).join(","));
  return out.join("\r\n") + "\r\n";
}

function safeFilename(name){
  let cleaned = Array.from(String(name))
    .map(c => /[A-Za-z0-9\-_]/.test(c) ? c : "_").join("");
  cleaned = cleaned.replace(/^_+|_+$/g,"");
  return cleaned || "sheet";
}

// Rewrite each sheet's Timestamp column from UTC to Central, like the script.
function sheetToCsv(sheet){
  const headers = sheet.headers || [];
  const rows = (sheet.rows || []).map(row=>{
    const ts = row.Timestamp;
    if(ts){
      try{ return {...row, Timestamp: formatCentral(parseRowTimestamp(ts))}; }
      catch(e){ /* leave as-is */ }
    }
    return row;
  });
  return toCsv(headers, rows);
}

const GAP_HEADERS = ["sensor","gap_start","gap_end","duration_minutes","estimated_missing_readings","ongoing"];
function gapsToCsv(gaps){
  return toCsv(GAP_HEADERS, gaps);
}

function downloadBlob(filename, text){
  const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* ====================================================================
   Fetch (port of fetch_data)
==================================================================== */
async function fetchData(deploymentId, apiKey, sinceParam){
  const url = `https://script.google.com/macros/s/${encodeURIComponent(deploymentId)}/exec`
            + `?api_key=${encodeURIComponent(apiKey)}&since=${encodeURIComponent(sinceParam)}`;
  let res;
  try{
    res = await fetch(url, {method:"GET", redirect:"follow", referrerPolicy:"no-referrer"});
  }catch(err){
    throw new FetchError(
      "Couldn't reach the endpoint",
      "The request was blocked by the browser, usually a CORS or network issue. " +
      "Make sure the Apps Script web app is deployed with access set to “Anyone,” " +
      "and that you’re online."
    );
  }
  if(!res.ok){
    throw new FetchError(`Endpoint returned HTTP ${res.status}`,
      "Check the deployment ID and API key, then try again.");
  }
  let json;
  try{ json = await res.json(); }
  catch(e){
    throw new FetchError("Endpoint didn't return JSON",
      "The response wasn't valid JSON — double-check the deployment ID points at the data endpoint.");
  }
  if(json.status !== "success"){
    throw new FetchError("Endpoint returned an error", JSON.stringify(json, null, 2), true);
  }
  return json;
}
class FetchError extends Error{
  constructor(title, detail, isJson){ super(title); this.title=title; this.detail=detail; this.isJson=!!isJson; }
}

/* ====================================================================
   DOM
==================================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const el = {
  connForm:$("connForm"), connInfo:$("connInfo"), connMeta:$("connMeta"),
  deploymentId:$("deploymentId"), apiKey:$("apiKey"), remember:$("remember"),
  saveConn:$("saveConn"), changeConn:$("changeConn"), forgetConn:$("forgetConn"),
  toggleKey:$("toggleKey"),
  hours:$("hours"), since:$("since"),
  rememberSince:$("rememberSince"), rememberSinceRow:$("rememberSinceRow"),
  workerCount:$("workerCount"),
  gapThreshold:$("gapThreshold"), expectedInterval:$("expectedInterval"),
  fetchBtn:$("fetchBtn"), fetchLabel:$("fetchLabel"), connectFirst:$("connectFirst"),
  status:$("status"), results:$("results")
};

/* ---- Connection persistence ---- */
function maskTail(s, n=4){
  if(!s) return "";
  if(s.length <= n) return "••••";
  return "••••" + s.slice(-n);
}
function showConnected(){
  el.connForm.classList.add("hidden");
  el.connInfo.classList.remove("hidden");
  el.connMeta.innerHTML =
    `Connected` +
    `<small>endpoint ${esc(maskTail(state.deploymentId))} &nbsp;&middot;&nbsp; key ${esc(maskTail(state.apiKey))}</small>`;
  el.fetchBtn.disabled = false;
  el.connectFirst.classList.add("hidden");
}
function showForm(){
  el.connInfo.classList.add("hidden");
  el.connForm.classList.remove("hidden");
  el.deploymentId.value = state.deploymentId;
  el.apiKey.value = state.apiKey;
  el.fetchBtn.disabled = true;
  el.connectFirst.classList.remove("hidden");
  el.deploymentId.focus();
}

function loadStored(){
  try{
    const remember = localStorage.getItem(LS.remember) !== "false";
    el.remember.checked = remember;
    const dep = localStorage.getItem(LS.dep) || "";
    const key = localStorage.getItem(LS.key) || "";
    if(dep && key){
      state.deploymentId = dep; state.apiKey = key;
      showConnected();
      return;
    }
  }catch(e){ /* storage unavailable */ }
  showForm();
}

el.saveConn.addEventListener("click", ()=>{
  const dep = el.deploymentId.value.trim();
  const key = el.apiKey.value.trim();
  if(!dep || !key){
    renderError(new FetchError("Add both fields",
      "Enter your deployment ID and API key, then save."));
    (dep ? el.apiKey : el.deploymentId).focus();
    return;
  }
  state.deploymentId = dep; state.apiKey = key;
  try{
    if(el.remember.checked){
      localStorage.setItem(LS.dep, dep);
      localStorage.setItem(LS.key, key);
      localStorage.setItem(LS.remember, "true");
    }else{
      localStorage.removeItem(LS.dep);
      localStorage.removeItem(LS.key);
      localStorage.setItem(LS.remember, "false");
    }
  }catch(e){ /* ignore */ }
  el.status.innerHTML = "";
  showConnected();
});

el.changeConn.addEventListener("click", showForm);
el.forgetConn.addEventListener("click", ()=>{
  state.deploymentId = ""; state.apiKey = "";
  try{
    localStorage.removeItem(LS.dep);
    localStorage.removeItem(LS.key);
  }catch(e){}
  el.deploymentId.value = ""; el.apiKey.value = "";
  showForm();
});

el.toggleKey.addEventListener("click", ()=>{
  const showing = el.apiKey.type === "text";
  el.apiKey.type = showing ? "password" : "text";
  el.toggleKey.textContent = showing ? "Show" : "Hide";
});

/* ---- Window mode toggle ---- */
document.querySelectorAll('input[name="winmode"]').forEach(r=>{
  r.addEventListener("change", ()=>{
    const mode = document.querySelector('input[name="winmode"]:checked').value;
    document.querySelectorAll(".mode").forEach(m=>{
      m.dataset.active = (m.dataset.mode === mode) ? "true" : "false";
    });
    el.hours.disabled = mode !== "hours";
    el.since.disabled = mode !== "since";
    const sinceMode = mode === "since";
    el.rememberSince.disabled = !sinceMode;
    el.rememberSinceRow.classList.toggle("dim", !sinceMode);
  });
});

/* ---- Remember the Since date ---- */
function saveSincePref(){
  try{
    if(el.rememberSince.checked){
      localStorage.setItem(LS.sinceRemember, "true");
      if(el.since.value) localStorage.setItem(LS.since, el.since.value);
    }else{
      localStorage.setItem(LS.sinceRemember, "false");
      localStorage.removeItem(LS.since);
    }
  }catch(e){ /* storage unavailable */ }
}
el.rememberSince.addEventListener("change", saveSincePref);
el.since.addEventListener("change", ()=>{ if(el.rememberSince.checked) saveSincePref(); });

function restoreSincePref(){
  let remember=false, saved="";
  try{
    remember = localStorage.getItem(LS.sinceRemember) === "true";
    saved = localStorage.getItem(LS.since) || "";
  }catch(e){ return; }
  el.rememberSince.checked = remember;
  if(remember && saved){
    el.since.value = saved;
    const r = document.querySelector('input[name="winmode"][value="since"]');
    r.checked = true;
    r.dispatchEvent(new Event("change")); // switches UI into Since mode
  }
}
// clicking inside a mode row selects its radio
document.querySelectorAll(".mode").forEach(m=>{
  m.addEventListener("click", e=>{
    if(e.target.tagName === "INPUT" && e.target.type !== "radio") return;
    const radio = m.querySelector('input[type=radio]');
    if(!radio.checked){ radio.checked = true; radio.dispatchEvent(new Event("change")); }
  });
});

/* ---- Resolve the requested window into a since instant ---- */
function resolveWindow(now){
  const mode = document.querySelector('input[name="winmode"]:checked').value;
  if(mode === "since"){
    const v = el.since.value; // "YYYY-MM-DDTHH:MM" or with ":SS"
    if(!v) throw new FetchError("Pick a start time",
      "Choose a Central start time, or switch to “Last … hours.”");
    const [datePart, timePart] = v.split("T");
    const [y,mo,d] = datePart.split("-").map(Number);
    const [h,mi,s] = timePart.split(":").map(Number);
    return centralWallToInstant(y, mo, d, h, mi, s || 0);
  }
  let hours = parseFloat(el.hours.value);
  if(!(hours > 0)) hours = 24;
  return new Date(now.getTime() - hours*3600*1000);
}

/* ====================================================================
   Run
==================================================================== */
el.fetchBtn.addEventListener("click", run);

async function run(){
  if(!state.deploymentId || !state.apiKey) return;

  let now, sinceDt;
  try{
    now = new Date();
    sinceDt = resolveWindow(now);
  }catch(err){
    renderError(err); return;
  }

  state.workerCount = Math.max(0, parseInt(el.workerCount.value, 10) || 0);
  const thresholdMin = Math.max(1, parseInt(el.gapThreshold.value,10) || 75);
  const expectedMin = Math.max(1, parseInt(el.expectedInterval.value,10) || 62);
  const sinceParam = formatCentral(sinceDt);

  setBusy(true);
  el.status.innerHTML = "";
  el.results.innerHTML = "";

  try{
    const data = await fetchData(state.deploymentId, state.apiKey, sinceParam);
    const gaps = findGaps(data, now, sinceDt, thresholdMin, expectedMin);

    state.lastData = data;
    state.lastGaps = gaps;
    state.runStamp = runStampCentral(now);

    renderResults({data, gaps, now, sinceDt, thresholdMin, expectedMin});
  }catch(err){
    renderError(err);
  }finally{
    setBusy(false);
  }
}

function setBusy(busy){
  el.fetchBtn.disabled = busy;
  el.fetchLabel.innerHTML = busy
    ? '<span class="spin" aria-hidden="true"></span> Fetching…'
    : "Fetch data";
}

/* ====================================================================
   Render
==================================================================== */
function renderError(err){
  const title = err.title || "Something went wrong";
  const detail = err.detail || err.message || "";
  const body = err.isJson
    ? `<pre>${esc(detail)}</pre>`
    : `<div>${esc(detail)}</div>`;
  el.status.innerHTML =
    `<div class="banner banner-err">
       <span class="pip pip-err" aria-hidden="true"></span>
       <div><h3>${esc(title)}</h3>${body}</div>
     </div>`;
}

function renderResults({data, gaps, now, sinceDt, thresholdMin, expectedMin}){
  const sheets = data.sheets || {};
  const names = Object.keys(sheets).filter(isTrackedTab);
  const totalRows = names.reduce((n,k)=> n + (sheets[k].row_count ?? (sheets[k].rows||[]).length), 0);
  const ongoing = gaps.filter(g=>g.ongoing==="yes");
  const historical = gaps.length - ongoing.length;

  let html = "";

  // headline banner
  if(ongoing.length){
    html += `<div class="banner banner-down">
      <span class="pip pip-down" aria-hidden="true"></span>
      <div>
        <h3>${ongoing.length} sensor${ongoing.length>1?"s":""} currently dark</h3>
        <div>No readings in the last ${thresholdMin}+ minutes:</div>
        <ul>${ongoing.map(g=>
          `<li>${esc(g.sensor)} — dark since ${esc(g.gap_start)} (~${g.duration_minutes} min)</li>`
        ).join("")}</ul>
      </div>
    </div>`;
  } else {
    html += `<div class="banner banner-ok">
      <span class="pip pip-ok" aria-hidden="true"></span>
      <div><h3>All sensors reporting</h3>
      <div>No sensor has gone silent past the ${thresholdMin}-minute threshold.</div></div>
    </div>`;
  }

  // summary line
  html += `<div class="summary-line">
    Fetched since <b>${esc(formatCentral(sinceDt))}</b> &middot;
    <b>${names.length}</b> sensor${names.length===1?"":"s"} &middot;
    <b>${totalRows.toLocaleString()}</b> rows &middot;
    as of <b>${esc(formatCentral(now))}</b>
  </div>`;

  // downloads
  html += `<div class="downloads">
    <button class="btn btn-primary" id="dlZip">Download CSVs (.zip)</button>
    ${gaps.length ? `<button class="btn btn-secondary" id="dlGap">Download gap report</button>` : ""}
  </div>
  <p class="hint">The ZIP holds one CSV per sensor (with <code>Timestamp</code> in Central time)${gaps.length?` plus <code>gap_report.csv</code>`:``}.</p>`;

  // sensor inventory
  if(names.length){
    html += `<div class="sensors">` + names.map(name=>{
      const count = sheets[name].row_count ?? (sheets[name].rows||[]).length;
      const isDown = ongoing.some(g=>g.sensor===name);
      return `<div class="sensor-row">
        <span class="name" title="${esc(name)}">${esc(name)}</span>
        <span class="right">
          <span class="count">${Number(count).toLocaleString()} rows</span>
          <span class="stat ${isDown?"down":"up"}">${isDown?"● dark":"● live"}</span>
          <button class="btn-link dl-one" data-sensor="${esc(name)}">CSV</button>
        </span>
      </div>`;
    }).join("") + `</div>`;
  }

  // gap table
  if(gaps.length){
    html += `<div class="table-wrap"><table>
      <thead><tr>
        <th>Sensor</th><th>Gap start</th><th>Gap end</th>
        <th>Duration (min)</th><th>Est. missing</th><th>Ongoing</th>
      </tr></thead><tbody>` +
      gaps.map(g=>`<tr class="${g.ongoing==="yes"?"ongoing":""}">
        <td>${esc(g.sensor)}</td>
        <td>${esc(g.gap_start)}</td>
        <td>${esc(g.gap_end)}</td>
        <td>${g.duration_minutes}</td>
        <td>${g.estimated_missing_readings}</td>
        <td><span class="tag ${g.ongoing==="yes"?"tag-yes":"tag-no"}">${g.ongoing}</span></td>
      </tr>`).join("") +
      `</tbody></table></div>
      <p class="hint">${gaps.length} gap${gaps.length===1?"":"s"} ≥ ${thresholdMin} min — ${ongoing.length} ongoing, ${historical} historical. Expected interval ≈ ${expectedMin} min.</p>`;
  } else {
    html += `<p class="hint">No gaps ≥ ${thresholdMin} minutes found.</p>`;
  }

  el.results.innerHTML = html;

  // wire downloads
  const zipBtn = $("dlZip");
  if(zipBtn) zipBtn.addEventListener("click", downloadAllZip);
  const gapBtn = $("dlGap");
  if(gapBtn) gapBtn.addEventListener("click", ()=> downloadBlob("gap_report.csv", gapsToCsv(state.lastGaps)));
  document.querySelectorAll(".dl-one").forEach(b=>{
    b.addEventListener("click", ()=>{
      const name = b.dataset.sensor;
      const sheet = state.lastData.sheets[name];
      downloadBlob(`${safeFilename(name)}.csv`, sheetToCsv(sheet));
    });
  });
}

async function downloadAllZip(){
  const data = state.lastData, gaps = state.lastGaps;
  if(!data) return;

  // Fallback if JSZip failed to load: download each CSV individually.
  if(typeof JSZip === "undefined"){
    for(const [name, sheet] of Object.entries(data.sheets||{})){
      if(!isTrackedTab(name)) continue;
      downloadBlob(`${safeFilename(name)}.csv`, sheetToCsv(sheet));
    }
    if(gaps && gaps.length) downloadBlob("gap_report.csv", gapsToCsv(gaps));
    return;
  }

  const zip = new JSZip();
  const folderName = `sheet_data_${state.runStamp}`;
  const folder = zip.folder(folderName);
  for(const [name, sheet] of Object.entries(data.sheets||{})){
    if(!isTrackedTab(name)) continue;
    folder.file(`${safeFilename(name)}.csv`, sheetToCsv(sheet));
  }
  if(gaps && gaps.length) folder.file("gap_report.csv", gapsToCsv(gaps));

  const blob = await zip.generateAsync({type:"blob"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${folderName}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* ---- boot ---- */
loadStored();
restoreSincePref();
