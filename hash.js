/* =========================
   File Hash Verifier Script
   - Only SHA-256 (streaming, multi-GB safe)
   ========================= */

const $$ = sel => document.querySelector(sel);
const hexBytes = u8 => Array.from(u8, b => b.toString(16).padStart(2,'0')).join('');
const cleanHex = s => (s || '').toLowerCase().replace(/[^0-9a-f]/g, '');

/* ---------- Streaming SHA-256 ---------- */
class SHA256Ctx{
  constructor(){
    this.h = new Int32Array([
      0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
      0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
    ]);
    this.len = 0n; // bits
  }
}
const K256 = new Int32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const rotr = (x,n)=> (x>>>n) | (x<<(32-n));
const ch   = (x,y,z)=> (x & y) ^ (~x & z);
const maj  = (x,y,z)=> (x & y) ^ (x & z) ^ (y & z);
const bsig0 = x => rotr(x,2)  ^ rotr(x,13) ^ rotr(x,22);
const bsig1 = x => rotr(x,6)  ^ rotr(x,11) ^ rotr(x,25);
const ssig0 = x => rotr(x,7)  ^ rotr(x,18) ^ (x>>>3);
const ssig1 = x => rotr(x,17) ^ rotr(x,19) ^ (x>>>10);

function sha256ProcessBlocks(ctx, u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length & ~63;
  const W = new Int32Array(64);
  let [a,b,c,d,e,f,g,h] = ctx.h;

  for (let i=0;i<n;i+=64){
    for (let t=0;t<16;t++) W[t] = dv.getUint32(i+t*4, false) | 0;
    for (let t=16;t<64;t++){
      W[t] = (((W[t-16] + ssig0(W[t-15])) | 0) + ((W[t-7] + ssig1(W[t-2])) | 0)) | 0;
    }
    let A=a,B=b,C=c,D=d,E=e,F=f,G=g,H=h;
    for (let t=0;t<64;t++){
      const T1 = (H + bsig1(E) + ch(E,F,G) + K256[t] + W[t]) | 0;
      const T2 = (bsig0(A) + maj(A,B,C)) | 0;
      H=G; G=F; F=E; E=(D + T1) | 0; D=C; C=B; B=A; A=(T1 + T2) | 0;
    }
    a=(a+A)|0; b=(b+B)|0; c=(c+C)|0; d=(d+D)|0;
    e=(e+E)|0; f=(f+F)|0; g=(g+G)|0; h=(h+H)|0;
  }
  ctx.h[0]=a; ctx.h[1]=b; ctx.h[2]=c; ctx.h[3]=d;
  ctx.h[4]=e; ctx.h[5]=f; ctx.h[6]=g; ctx.h[7]=h;
}
function sha256Final(ctx, carry){
  const rem = carry.length;
  const padLen = (rem<56?56-rem:56+64-rem);
  const pad = new Uint8Array(padLen+8);
  pad[0]=0x80;
  const lenBits = ctx.len;
  const hi = Number((lenBits >> 32n) & 0xffffffffn)>>>0;
  const lo = Number(lenBits & 0xffffffffn)>>>0;
  const dv = new DataView(pad.buffer, padLen, 8);
  dv.setUint32(0, hi, false);
  dv.setUint32(4, lo, false);

  const finalBuf = new Uint8Array(rem + pad.length);
  finalBuf.set(carry,0); finalBuf.set(pad,rem);
  sha256ProcessBlocks(ctx, finalBuf);

  const out = new Uint8Array(32);
  const outDV = new DataView(out.buffer);
  for (let i=0;i<8;i++) outDV.setUint32(i*4, ctx.h[i]>>>0, false);
  return out;
}
async function sha256Blob(blob, chunkSize=16*1024*1024){
  const ctx = new SHA256Ctx();
  let off=0; let carry=new Uint8Array(0);
  while(off<blob.size){
    const end=Math.min(off+chunkSize, blob.size);
    const chunk=new Uint8Array(await blob.slice(off,end).arrayBuffer());
    off=end; ctx.len += BigInt(chunk.length) * 8n;

    let buf = carry.length ? (new Uint8Array(carry.length + chunk.length)) : chunk;
    if(carry.length){ buf.set(carry,0); buf.set(chunk,carry.length); }

    sha256ProcessBlocks(ctx, buf);
    const rem = buf.length & 63; carry = rem ? buf.slice(buf.length-rem) : new Uint8Array(0);
  }
  return hexBytes(sha256Final(ctx, carry));
}

/* ---------- Only SHA-256 ---------- */
const ALGOS = [
  { key: 'sha-256', label: 'SHA-256', length: 64, impl: file => sha256Blob(file) }
];

/* ---------- UI Wiring ---------- */
const fileInput = $$('#file');
const drop = $$('#drop');
const fileInfo = $$('#fileInfo');
const results = $$('#results');
const expected = $$('#expected');
const status = $$('#status');

let computing=false, lastComputed=null;
const algoFromLength = len => ALGOS.find(a => a.length===len);
const getCached = () => lastComputed || {};

function setFileInfo(file){
  if(!file){ fileInfo.textContent='No file selected'; return; }
  const sizeMB = file.size/(1024*1024);
  fileInfo.innerHTML = `${file.name} • ${sizeMB.toFixed(sizeMB<10?1:0)} MB`;
}

function renderRows(hashMap={}, compareHex=''){
  results.innerHTML='';
  const cmp = cleanHex(compareHex);
  const cmpAlgo = algoFromLength(cmp.length);

  ALGOS.forEach(a=>{
    const row = document.createElement('div'); row.className='row';
    const statusPill = document.createElement('span');
    const known = hashMap[a.key];
    let verdict='neutral', label='Pending';

    if(known === null){ verdict='bad'; label='error'; }
    else if(known){
      if(cmp && cmpAlgo && cmpAlgo.key===a.key){
        if(known===cmp){ verdict='ok'; label='**True**'; } else { verdict='bad'; label='**False**'; }
      } else if(!cmp){ label='—'; }
      else if(cmp && cmpAlgo && cmpAlgo.key!==a.key){ label='len mismatch'; }
      else if(cmp && !cmpAlgo){ label='unknown algo'; }
    }

    statusPill.className=`pill ${verdict}`; statusPill.innerHTML=label;

    const left=document.createElement('div');
    left.innerHTML=`<span class="alg">${a.label}</span><div class="tiny">256-bit</div>`;

    const mid=document.createElement('div');
    mid.className='hash mono';
    mid.textContent = known || (known===null?'—':'…');

    const right=document.createElement('div'); right.className='controls';
    const copyBtn=document.createElement('button'); copyBtn.className='btn copy'; copyBtn.textContent='Copy'; copyBtn.disabled=!known;
    copyBtn.onclick=()=>{ navigator.clipboard.writeText(known); copyBtn.textContent='Copied'; setTimeout(()=>copyBtn.textContent='Copy',900); };

    right.appendChild(statusPill); right.appendChild(copyBtn);
    row.appendChild(left); row.appendChild(mid); row.appendChild(right);
    results.appendChild(row);
  });
}

async function computeAll(file){
  const map = {};
  try {
    map['sha-256'] = await sha256Blob(file);
  } catch (e) {
    console.error(e);
    map['sha-256'] = null;
  }
  return map;
}

function updateStatus(){
  const pasted = cleanHex(expected.value);
  if(!pasted){ status.textContent='Paste an expected hash to verify (auto-detect by length).'; return; }
  const algo = algoFromLength(pasted.length);
  if(!algo){ status.textContent='Unknown hash length; cannot auto-detect algorithm.'; return; }
  const have = getCached()[algo.key];
  if(!have){
    status.textContent = getCached()[algo.key]===null ? `${algo.label} failed for this file.` : `Waiting for ${algo.label}…`;
    return;
  }
  status.innerHTML = (have===pasted)
    ? `Match on <strong>${algo.label}</strong>: <strong>True</strong>`
    : `Match on <strong>${algo.label}</strong>: <strong>False</strong>`;
}

/* ---------- Events ---------- */
drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', ()=> drop.classList.remove('dragover'));
drop.addEventListener('drop', async e=>{
  e.preventDefault(); drop.classList.remove('dragover');
  const f = e.dataTransfer.files?.[0];
  if(f){ fileInput.files = e.dataTransfer.files; await handleFile(f); }
});
fileInput.addEventListener('change', async e=>{
  const f = e.target.files?.[0];
  if(f) await handleFile(f);
});
expected.addEventListener('input', ()=>{
  renderRows(getCached(), expected.value);
  updateStatus();
});

async function handleFile(file){
  if(computing) return;
  setFileInfo(file);
  status.textContent='Computing SHA-256…';
  renderRows({}, expected.value);
  computing=true;
  try{
    lastComputed = await computeAll(file);
    renderRows(lastComputed, expected.value);
    updateStatus();
    status.textContent='Done.';
  }catch(e){
    console.error(e);
    status.textContent='Error while hashing this file.';
  }finally{
    computing=false;
  }
}

