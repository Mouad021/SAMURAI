(() => {
  "use strict";

  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_FINAL_V2) return;
  window.__cal_auto_pick_day_slot_FINAL_V2 = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // ✅ إذا بغيتي 0 مايبانوش خليه true، إلا بغيتي يبانو (بالأحمر) خليه false
  const REMOVE_ZERO_FROM_LIST = true;

  // ==============
  // STATE
  // ==============
  const STATE = {
    pickedDay: "",
    bestId: null,
    bestText: "",
    ddl: null,
    ddlInput: null,
    ds: null,
    handlersBound: false,
    interceptorInstalled: false,
    patchApplied: false,
    lastRespSig: "",
    refreshScheduled: false
  };

  function scheduleOnce(fn) {
    if (STATE.refreshScheduled) return;
    STATE.refreshScheduled = true;
    requestAnimationFrame(() => {
      STATE.refreshScheduled = false;
      try { fn(); } catch {}
    });
  }

  // =========================
  // 1) availDates
  // =========================
  function getAvailDays() {
    const a = window.availDates?.ad;
    if (!Array.isArray(a)) return [];
    return a.filter(d =>
      d &&
      d.DateText &&
      (d.SingleSlotAvailable === true || d.SingleSlotAvailable === "true") &&
      (d.AppointmentDateType === 0 || d.AppointmentDateType === "0")
    );
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // =========================
  // 2) انتظار jQuery + Kendo
  // =========================
  async function waitForJqKendo(maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.jQuery && window.kendo) return true;
      await sleep(80);
    }
    return false;
  }

  async function waitFor(pred, maxMs = 20000, stepMs = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { if (pred()) return true; } catch {}
      await sleep(stepMs);
    }
    return false;
  }

  // =========================
  // 3) DatePicker الحقيقي
  // =========================
  function findRealDatePicker() {
    const $ = window.jQuery;
    if (!$) return null;

    const wrappers = Array.from(document.querySelectorAll(".k-datepicker, .k-widget.k-datepicker, .k-picker-wrap"));
    for (const w of wrappers) {
      const wrap = w.classList.contains("k-picker-wrap")
        ? w.closest(".k-datepicker, .k-widget.k-datepicker")
        : w;
      if (!wrap) continue;

      const inp = wrap.querySelector('input[data-role="datepicker"], input.k-input');
      if (!inp || inp.disabled) continue;

      let dp = $(inp).data("kendoDatePicker") || $(wrap).data("kendoDatePicker");
      if (!dp && window.kendo?.widgetInstance) {
        try { dp = window.kendo.widgetInstance($(wrap)); } catch {}
      }

      if (dp && (isVisible(wrap) || isVisible(inp))) return { inp, dp, wrap };
    }

    const inputs = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    for (const inp of inputs) {
      if (inp.disabled) continue;
      const dp = $(inp).data("kendoDatePicker");
      if (dp && isVisible(inp)) return { inp, dp, wrap: inp.closest(".k-datepicker, .k-widget.k-datepicker") };
    }
    return null;
  }

  // =========================
  // 4) Slot DropDownList الحقيقي
  // =========================
  function findRealSlotDDL() {
    const $ = window.jQuery;
    if (!$) return null;

    const known = document.querySelector('input#AppointmentSlot[data-role="dropdownlist"]');
    if (known) {
      const ddl = $(known).data("kendoDropDownList");
      if (ddl) return { inp: known, ddl };
    }

    const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (!ddl) continue;
      const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
      if (wrap && isVisible(wrap)) return { inp: x, ddl };
    }

    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (ddl) return { inp: x, ddl };
    }
    return null;
  }

  // =========================
  // 5) حقن التاريخ
  // =========================
  function setDateWithKendo(dp, inp, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    try {
      dp.value(dateObj);
      dp.trigger("change");
      dp.element?.trigger?.("change");
      log("Date injected:", dateText);
      return true;
    } catch (e) {
      warn("Kendo date inject failed", e);
    }

    try {
      inp.value = dateText;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      log("Date injected via input events:", dateText);
      return true;
    } catch (e) {
      warn("Date input fallback failed", e);
      return false;
    }
  }

  // =========================
  // 6) normalize slots => Name = "08:30-09:00 (count : X)"
  // =========================
  function normalizeSlots(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];

    const all = json.data.map(x => {
      const c = Number(x?.Count) || 0;
      const baseName = String(x?.Name || "").replace(/\s*\(count\s*:\s*\d+\)\s*$/i, "").trim();
      return {
        ...x,
        Count: c,
        __rawName: baseName,
        __DisplayName: `${baseName} (count : ${c})`
      };
    });

    return REMOVE_ZERO_FROM_LIST ? all.filter(x => x.Count > 0) : all;
  }

  function pickBestSlot(items) {
    if (!Array.isArray(items) || !items.length) return null;
    let best = null;
    for (const s of items) {
      if (!best || (Number(s.Count) || 0) > (Number(best.Count) || 0)) best = s;
    }
    return best;
  }

  // =========================
  // 7) فرض النص فـ span.k-input
  // =========================
  function forceSetDropDownDisplay(ddl, displayText) {
    try {
      const wrap = ddl.wrapper?.[0];
      const kInput = wrap ? wrap.querySelector("span.k-input") : null;
      if (kInput && displayText) kInput.textContent = displayText;
    } catch {}
  }

  // =========================
  // 8) DS بدون template (باش يبقى الستايل ديالك والوانك ديالك)
  // =========================
  function buildAndSetDS(ddl, itemsWithDisplay) {
    const dataForDS = itemsWithDisplay.map(x => ({
      ...x,
      // ✅ هادي هي اللي كتخلّي كل LI يطبع count
      Name: x.__DisplayName,
      // احتياط
      __rawName: x.__rawName,
      __count: Number(x.Count) || 0
    }));

    if (!STATE.ds) {
      STATE.ds = new window.kendo.data.DataSource({ data: dataForDS });
      try { window.slotDataSource = STATE.ds; } catch {}
      ddl.setDataSource(STATE.ds);
    } else {
      // تحديث سريع
      STATE.ds.data(dataForDS);
    }

    // refresh مرة وحدة وبـ rAF لتفادي lag
    scheduleOnce(() => {
      try { ddl.refresh(); } catch {}
    });
  }

  function selectBestAndLock(ddl, items) {
    const best = pickBestSlot(items);
    if (!best) return false;

    STATE.bestId = String(best.Id);
    STATE.bestText = best.__DisplayName;

    try {
      // value بلا spam ديال change
      ddl.value(STATE.bestId);

      // نخلي الفورم يعرف القيمة (مرة وحدة)
      ddl.trigger("change");

      // نثبت display
      forceSetDropDownDisplay(ddl, STATE.bestText);
      log("Slot selected:", STATE.bestText, "Id:", STATE.bestId, "Count:", best.Count);
      return true;
    } catch (e) {
      warn("selectBestAndLock failed", e);
      return false;
    }
  }
  function getIdCountMapFromDS() {
    try {
      const map = new Map();
      if (!STATE.ds) return map;
      const data = STATE.ds.data ? STATE.ds.data() : [];
      for (const it of data) {
        const id = String(it.Id);
        const c  = Number(it.Count ?? it.__count ?? 0) || 0;
        map.set(id, c);
      }
      return map;
    } catch {
      return new Map();
    }
  }
  
  function fixListDomClickable(ddl) {
    try {
      if (!ddl || !ddl.ul) return;
  
      const idCount = getIdCountMapFromDS();
  
      // ddl.ul = <ul> ديال اللائحة
      const lis = ddl.ul[0] ? ddl.ul[0].querySelectorAll("li.k-item") : [];
      lis.forEach((li) => {
        // جيب id ديال item من kendo (أفضل) أو من index
        let id = null;
        try {
          const di = ddl.dataItem(li);
          if (di && di.Id != null) id = String(di.Id);
        } catch {}
  
        // fallback: من data-offset-index
        if (!id) {
          const idx = li.getAttribute("data-offset-index");
          try {
            const view = ddl.dataSource && ddl.dataSource.view ? ddl.dataSource.view() : [];
            const di2 = view && idx != null ? view[Number(idx)] : null;
            if (di2 && di2.Id != null) id = String(di2.Id);
          } catch {}
        }
  
        const count = id && idCount.has(id) ? idCount.get(id) : 0;
  
        // ✅ رجّع clickability للساعات المتاحة
        const shouldEnable = count > 0;
  
        // حيد disable classes/attrs اللي كيديرهم الموقع
        li.classList.remove("k-state-disabled");
        li.setAttribute("aria-disabled", "false");
        li.style.pointerEvents = "auto";
        li.style.opacity = "1";
  
        const inner = li.querySelector(".slot-item") || li.firstElementChild;
        if (inner) {
          inner.style.pointerEvents = "auto";
          inner.style.cursor = shouldEnable ? "pointer" : "not-allowed";
          // رجّع اللون حسب count
          inner.classList.toggle("bg-success", shouldEnable);
          inner.classList.toggle("bg-danger", !shouldEnable);
          // إذا بغيتي 0 يبان (ولكن disabled) خلي هاد السطر
          if (!shouldEnable) {
            li.classList.add("k-state-disabled");
            li.setAttribute("aria-disabled", "true");
            inner.style.pointerEvents = "none";
          }
        }
      });
    } catch {}
  }
  
  function scheduleFixList(ddl) {
    // باش مانزيدوش lag: مرة وحدة فـ tick
    scheduleOnce(() => {
      try { fixListDomClickable(ddl); } catch {}
    });
  }

  // =========================
  // 9) PATCH OnSlotOpen: خليه يخدم، ومن بعد رجّع counts + selection
  // =========================
  function patchSiteOnSlotOpen() {
    if (STATE.patchApplied) return;
    STATE.patchApplied = true;

    if (typeof window.OnSlotOpen === "function") {
      const original = window.OnSlotOpen;

      window.OnSlotOpen = function patchedOnSlotOpen() {
        // ✅ خليه يدير اللي بغا
        let ret;
        try { ret = original.apply(this, arguments); } catch (e) {}

        // ✅ من بعد: رجّع ds ديالنا (إذا عندنا) + ثبت selection + display
        setTimeout(() => {
          try {
            const ddl = STATE.ddl;
            if (!ddl) return;
          
            if (STATE.ds) {
              ddl.setDataSource(STATE.ds);
              scheduleFixList(STATE.ddl);
              ddl.refresh();
            }

            if (STATE.bestId) {
              ddl.value(STATE.bestId);
              forceSetDropDownDisplay(ddl, STATE.bestText);
            }
          } catch {}
        }, 0);

        return ret;
      };

      log("Patched OnSlotOpen (post-fix restore counts/selection).");
    }
  }

  function bindKeepSelectionHandlers(ddl) {
    if (STATE.handlersBound) return;
    STATE.handlersBound = true;
  
    ddl.bind("open", () => {
      setTimeout(() => {
        try {
          // ثبت الاختيار
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          // ✅ رجّع اللائحة clickable + ألوان صحيحة
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });
  
    ddl.bind("dataBound", () => {
      setTimeout(() => {
        try {
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });
  
    ddl.bind("change", () => {
      setTimeout(() => {
        try {
          const di = ddl.dataItem();
          if (di && di.Id != null) {
            STATE.bestId = String(di.Id);
            STATE.bestText = String(di.Name || "");
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          // ✅ حتى بعد التغيير: خليه ما يقلبش المختار “محظور”
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });
  }
  

  function injectSlotsAndSelectBest(ddl, itemsWithDisplay) {
    if (!ddl) return;
    if (!itemsWithDisplay || !itemsWithDisplay.length) {
      warn("No slots to show (maybe all Count=0).");
      return;
    }

    buildAndSetDS(ddl, itemsWithDisplay);
    patchSiteOnSlotOpen();
    bindKeepSelectionHandlers(ddl);

    // اختار أحسن واحدة مباشرة (كما النسخة القديمة)
    selectBestAndLock(ddl, itemsWithDisplay);
  }

  // =========================
  // 11) XHR interceptor
  // =========================
  function signatureOf(json) {
    try {
      const arr = json?.data;
      if (!Array.isArray(arr)) return "";
      return arr.map(x => `${x.Id}:${x.Count}`).join("|");
    } catch {
      return "";
    }
  }

  function onSlotsResponse(json) {
    try {
      const sig = signatureOf(json);
      if (sig && sig === STATE.lastRespSig) return;
      STATE.lastRespSig = sig;

      const items = normalizeSlots(json);
      if (!items.length) return warn("Slots response empty after normalize.");

      if (!STATE.ddl) {
        const o = findRealSlotDDL();
        if (!o) return warn("Slot DDL not found");
        STATE.ddl = o.ddl;
        STATE.ddlInput = o.inp;
        log("Slot DDL ready:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
      }

      injectSlotsAndSelectBest(STATE.ddl, items);
    } catch (e) {
      warn("onSlotsResponse error", e);
    }
  }

  function installXHRInterceptor() {
    if (STATE.interceptorInstalled) return;
    STATE.interceptorInstalled = true;

    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__cal_url = url;
      return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
      try {
        this.addEventListener("load", function() {
          try {
            const url = this.__cal_url || "";
            if (!SLOTS_URL_RE.test(url)) return;

            const txt = this.responseText || "";
            const json = JSON.parse(txt);
            onSlotsResponse(json);
          } catch {}
        });
      } catch {}
      return _send.apply(this, arguments);
    };
  }

  // =========================
  // 12) BOOT
  // =========================
  (async () => {
    if (!await waitForJqKendo()) return warn("jQuery/Kendo not ready (timeout)");

    installXHRInterceptor();

    // يوم عشوائي
    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    STATE.pickedDay = picked.DateText;
    log("Picked random day:", STATE.pickedDay);

    // DatePicker الحقيقي
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // حضّر ddl من اللول
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const o = findRealSlotDDL();
    if (o) {
      STATE.ddl = o.ddl;
      STATE.ddlInput = o.inp;
      patchSiteOnSlotOpen();
      bindKeepSelectionHandlers(STATE.ddl);
      log("Slot DDL prepared:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
    }

    // حقن التاريخ -> الموقع يرسل GetAvailableSlotsByDate
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, STATE.pickedDay)) return;
  })().catch(e => warn("Fatal", e));

})();
