(()=>{

"use strict";

/* ------------------------------------------
   SLOTSELECTION — BLOCKED SEND VERSION
   NO REQUEST WILL BE SENT TO SERVER
------------------------------------------- */

/* ======== GLOBALS ======== */
let __dateEl=null,__slotEl=null;
let __dateName=null,__slotName=null;
let __selectedSlotId=null;
let __lastRandomDayText="";
let __lastOpenSlots=[];
let __tpl=null;
let __countdownBtn=null;
let SAMURAI_ALL_MODE=false;
let AUTO_DELAY_MS=0;
let AUTO_ENABLED=false;

/* ======== SIMPLE UTILS ======== */
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function log(){console.log("[BLOCKED][DynSlots]",...arguments)}
function warn(){console.warn("[BLOCKED][DynSlots]",...arguments)}

/* ======== LOAD DELAYS ======== */
function loadDelaySnapshot(){
  try{
    const snap = window.__SAMURAI_STORAGE || {};
    const enabled = (snap.calendria_use_delays || "off")==="on";
    const raw     = snap.calendria_delay_slotselection;

    if(enabled && raw!==undefined && raw!==null){
      const n = parseFloat(String(raw).replace(",","."));
      if(!isNaN(n)&&n>=0){
        AUTO_DELAY_MS=n*1000;
        AUTO_ENABLED=true;
      }
    }

    log("Loaded delay:",AUTO_DELAY_MS,"ms");

  }catch(e){
    warn("delay read failed",e);
  }
}

/* ======== FIND ACTIVE INPUTS ======== */
function getActiveDateInput(){
  const all=Array.from(document.querySelectorAll('.k-datepicker input[data-role="datepicker"], .k-input'));
  return all.find(el=>el.offsetParent&&!el.disabled)||null;
}

function getActiveSlotHiddenInputRaw(){
  const all=Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
  return all.find(el=>el.offsetParent)||all[0]||null;
}

function captureStableNames(){
  if(!__dateEl){
    __dateEl=getActiveDateInput();
    __dateName=__dateEl?.name||null;
  }
  if(!__slotEl){
    __slotEl=getActiveSlotHiddenInputRaw();
    __slotName=__slotEl?.name||null;
  }
}

async function ensureStableNamesReady(maxTries=20){
  for(let i=0;i<maxTries;i++){
    captureStableNames();
    if(__dateName && __slotName) return true;
    await sleep(120);
  }
  warn("names missing",__dateName,__slotName);
  return false;
}

/* ======== READ PAGE SCRIPTS ======== */
function getAllScriptText(){
  return Array.from(document.scripts).map(s=>s.textContent||"").join("\n;\n");
}

function extractAvailDates(){
  try{
    const g=window.availDates||unsafeWindow?.availDates;
    if(g?.ad && Array.isArray(g.ad)) return g;
  }catch{}
  return null;
}

function extractGetSlotsTemplate(){
  const txt=getAllScriptText();
  const m=txt.match(/GetAvailableSlotsByDate\?[^"'\s]+/i);
  if(!m) return null;
  let raw=m[0];
  if(!raw.startsWith("/")) raw="/MAR/appointment/"+raw;
  const idx=raw.toLowerCase().indexOf("appointmentdate=");
  if(idx<0) return null;
  return {
    prefix: raw.slice(0,idx+"appointmentdate=".length),
    suffix: raw.slice(idx+"appointmentdate=".length)
  };
}

/* ======== PARSE OPEN SLOTS ======== */
function parseOpenSlots(resp){
  if(!resp?.success||!Array.isArray(resp.data)) return [];
  return resp.data.filter(s=>Number(s.Count)>0);
}

/* ======== UI HELPERS ======== */
function renderSlotBoxes(slots){
  __lastOpenSlots=slots;
  __selectedSlotId=null;

  const cont=document.getElementById("__cal_slots_boxes");
  if(!cont) return;
  cont.innerHTML="";

  if(!slots.length){
    cont.textContent="لا توجد نتائج بعد";
    return;
  }

  slots.forEach((slot,idx)=>{
    const b=document.createElement("button");
    b.className="cal-slot-btn";
    b.textContent=slot.Name+" (Count:"+slot.Count+")";
    b.onclick=()=>{
      __selectedSlotId=slot.Id;
      __slotEl.value=slot.Id;
    };
    cont.appendChild(b);
    if(idx===0) b.click();
  });
}

/* ======== BLOCKED: NO REQUEST WILL BE SENT ======== */
async function postSlotSelection(fd){
  warn("🚫 REQUEST BLOCKED — postSlotSelection WILL NOT SEND ANYTHING");
  warn("FormData preview:",fd);
  return {blocked:true};
}

/* ======== KEEP THE CHECK BUT IT WON'T TRIGGER ======== */
async function autoApplicantSelectionCheck(){
  warn("ApplicantSelectionCheck CALLED — BUT POST WAS BLOCKED SO NO REDIRECT");
  return false;
}

/* ======== INSTEAD OF SUBMIT → BLOCK ======== */
async function submitOneHour(){
  warn("🚫 submitOneHour BLOCKED");
}

async function postAllOpenSlotsAuto(){
  warn("🚫 SAMURAI ALL HOURS BLOCKED");
}

async function samuraiSubmitAll(){
  warn("🚫 samuraiSubmitAll BLOCKED");
}

/* ======== COUNTDOWN — FINISH WITHOUT SUBMIT ======== */
function startInlineCountdownAlways(ms,onDone){
  if(!__countdownBtn) return;
  if(ms<=0){
    __countdownBtn.textContent="0.000s";
    return;
  }
  const start=performance.now(), end=start+ms;
  function tick(now){
    const left=end-now;
    if(left<=0){
      __countdownBtn.textContent="0.000s";
      warn("⏳ Countdown finished — submit BLOCKED");
      return; // DO NOT EXECUTE SUBMIT
    }
    __countdownBtn.textContent=(left/1000).toFixed(3)+"s";
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ======== UI BUTTONS ======== */
function injectButtons(){
  const form=document.querySelector("form");
  if(!form) return;

  let bar=document.getElementById("__cal_actions_bar");
  if(bar) return;

  bar=document.createElement("div");
  bar.id="__cal_actions_bar";

  const b1=document.createElement("button");
  b1.textContent="SUBMIT";
  b1.onclick=()=>warn("🚫 SUBMIT BUTTON BLOCKED");

  const b2=document.createElement("button");
  b2.textContent="SAMURAI SUBMIT";
  b2.onclick=()=>warn("🚫 SAMURAI BUTTON BLOCKED");

  const bc=document.createElement("button");
  bc.className="cal-countdown";
  bc.textContent=(AUTO_DELAY_MS/1000).toFixed(3)+"s";
  __countdownBtn=bc;

  bar.appendChild(b1);
  bar.appendChild(b2);
  bar.appendChild(bc);
  form.appendChild(bar);
}

/* ======== BOOT ======== */
async function boot(){
  loadDelaySnapshot();
  injectButtons();
  await ensureStableNamesReady();

  const avail=extractAvailDates();
  __tpl=extractGetSlotsTemplate();

  if(avail?.ad && avail.ad.length){
    const openDays=avail.ad.filter(d=>d.SingleSlotAvailable);
    if(openDays.length){
      const random=openDays[0];
      __lastRandomDayText=random.DateText;
    }
  }

  startInlineCountdownAlways(AUTO_DELAY_MS,async()=>{
    warn("⏳ Countdown finished — but no submission allowed");
  });
}

boot();

})();
