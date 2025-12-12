(() => {
  "use strict";

  // ✅ بدّلها حسب صفحة موقعك
  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_FINAL_V2) return;
  window.__cal_auto_pick_day_slot_FINAL_V2 = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  // ✅ endpoint ديال الساعات (بدّلها إذا فموقعك مختلفة)
  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // ==============
  // STATE
  // ==============
  const STATE = {
    pickedDay: "",
    bestId: null,
    bestText: "",
    ddl: null,
    ddlInput: null,
    augmentedItems: null,
    ds: null,
    handlersBound: false,
    interceptorInstalled: false,
    patchApplied: false,
    lastRespSig: ""
  };

  // =========================
  // 1) availDates (نفس المتغير اللي عندك)
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
  // 3) DatePicker الحقيقي فقط
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

    // fallback
    const inputs = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    for (const inp of inputs) {
      if (inp.disabled) continue;
      const dp = $(inp).data("kendoDatePicker");
      if (dp && isVisible(inp)) return { inp, dp, wrap: inp.closest(".k-datepicker, .k-widget.k-datepicker") };
    }

    return null;
  }

  // =========================
  // 4) Slot DropDownList الحقيقي فقط
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
  // 5) حقن التاريخ (كيشعل AJAX ديال الموقع)
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
  // 6) تجهيز الساعات: زيد count فكل ساعة + (اختياري) حذف 0
  // =========================
  const REMOVE_ZERO_FROM_LIST = true; // ✅ إذا بغيتي 0 مايبانوش نهائياً خليه true

  function normalizeSlots(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];

    const all = json.data.map(x => ({ ...x, Count: Number(x?.Count) || 0 }));

    const filtered = REMOVE_ZERO_FROM_LIST ? all.filter(x => x.Count > 0) : all;

    return filtered.map(x => ({
      ...x,
      __DisplayName: `${x.Name} (count : ${x.Count})`
    }));
  }

  function pickBestSlot(items) {
    if (!Array.isArray(items) || !items.length) return null;
    let best = items[0];
    for (const s of items) {
      if ((Number(s.Count) || 0) > (Number(best.Count) || 0)) best = s;
    }
    return best;
  }

  // =========================
  // 7) فرض النص فـ span.k-input باش مايرجعش بلا count
  // =========================
  function forceSetDropDownDisplay(ddl, displayText) {
    try {
      const wrap = ddl.wrapper?.[0];
      const kInput = wrap ? wrap.querySelector("span.k-input") : null;
      if (kInput && displayText) kInput.textContent = displayText;
    } catch {}
  }

  function buildAndSetDS(ddl, itemsWithDisplay) {
    // نخلي جميع العناصر (إذا كنت كتحذف 0 فـ normalizeSlots غيبقاو غير المتاحين => كلهم خضر)
    const dataForDS = itemsWithDisplay.map(x => ({
      ...x,
      Name: x.__DisplayName,
      __rawName: x.Name,           // احتياط
      __count: Number(x.Count) || 0
    }));
  
    STATE.augmentedItems = itemsWithDisplay;
  
    // ✅ template فيه bg-success / bg-danger باش يرجعو الألوان
    // إذا كنت حادف Count=0 => كلهم bg-success
    const itemTpl  = `<div class="slot-item #= (__count>0 ? 'bg-success' : 'bg-danger') #"
                       style="border-radius:8px;padding:4px 18px 4px 28px;cursor:pointer;color:white;">
                       #= Name #
                     </div>`;
    const valueTpl = `<span>#= Name #</span>`;
  
    try {
      ddl.setOptions({
        dataTextField: "Name",
        dataValueField: "Id",
        template: itemTpl,
        valueTemplate: valueTpl
      });
    } catch {}
  
    // ✅ Performance: ما تعاودش تنشئ DataSource كل مرة
    if (!STATE.ds) {
      STATE.ds = new window.kendo.data.DataSource({ data: dataForDS });
      try { window.slotDataSource = STATE.ds; } catch {}
      ddl.setDataSource(STATE.ds);
      ddl.refresh();
    } else {
      // تحديث سريع بلا rebind
      STATE.ds.data(dataForDS);
      // refresh خفيف مرة وحدة فقط
      ddl.refresh();
    }
  }


  function selectBestAndLock(ddl) {
    const items = STATE.augmentedItems;
    if (!items || !items.length) return false;

    const best = pickBestSlot(items);
    if (!best) return false;

    STATE.bestId = String(best.Id);
    STATE.bestText = best.__DisplayName || `${best.Name} (count : ${best.Count})`;

    try {
      ddl.value(STATE.bestId);

      // ما نكثرش trigger باش ما يوقعش reset
      try { ddl.text(STATE.bestText); } catch {}
      forceSetDropDownDisplay(ddl, STATE.bestText);

      // change مرة وحدة باش الفورم/الڤاليو يتحيّن
      ddl.trigger("change");

      log("Slot selected:", STATE.bestText, "Id:", STATE.bestId, "Count:", best.Count);
      return true;
    } catch (e) {
      warn("selectBestAndLock failed", e);
      return false;
    }
  }

  // =========================
  // 9) Patch OnSlotOpen اللي كيدير disable/يبدّل Count (سبب “كتولي حمراء”)
  // =========================
  function patchSiteOnSlotOpen() {
    if (STATE.patchApplied) return;
    STATE.patchApplied = true;

    // إذا عندك function global اسمها OnSlotOpen (بحال اللي وريتي)
    if (typeof window.OnSlotOpen === "function") {
      const original = window.OnSlotOpen;

      window.OnSlotOpen = function patchedOnSlotOpen() {
        // ✅ فقط ربط datasource + refresh + حافظ على الاختيار
        try {
          const ddl = STATE.ddl || (window.jQuery ? window.jQuery(STATE.ddlInput).data("kendoDropDownList") : null);
          if (ddl && STATE.ds) {
            ddl.setDataSource(STATE.ds);
            ddl.refresh();
            if (STATE.bestId) {
              ddl.value(STATE.bestId);
              try { ddl.text(STATE.bestText); } catch {}
              forceSetDropDownDisplay(ddl, STATE.bestText);
            }
            return;
          }
        } catch {}

        // fallback: خليه يدوز الأصلي (ولكن غالباً هو سبب المشكل)
        try { return original.apply(this, arguments); } catch {}
      };

      log("Patched OnSlotOpen to prevent disabling/red selection issues.");
    }
  }

  // =========================
  // 10) Keep selection ثابت حتى فـ open/dataBound
  // =========================
  function bindKeepSelectionHandlers(ddl) {
    if (STATE.handlersBound) return;
    STATE.handlersBound = true;

    ddl.bind("open", () => {
      setTimeout(() => {
        try {
          // رجّع DS ديالنا إذا تبدّل
          if (STATE.ds) {
            ddl.setDataSource(STATE.ds);
            ddl.refresh();
          }
          // ثبت الاختيار
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            try { ddl.text(STATE.bestText); } catch {}
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
        } catch {}
      }, 0);
    });

    ddl.bind("dataBound", () => {
      setTimeout(() => {
        try {
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            try { ddl.text(STATE.bestText); } catch {}
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
        } catch {}
      }, 0);
    });

    ddl.bind("change", () => {
      try {
        const di = ddl.dataItem();
        if (di && di.Name) {
          // Name فيه count (حيت setDataSource ديالنا)
          STATE.bestId = String(di.Id);
          STATE.bestText = String(di.Name);
          forceSetDropDownDisplay(ddl, STATE.bestText);
        }
      } catch {}
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
    selectBestAndLock(ddl);
  }

  // =========================
  // 11) قراءة Response (XHR interceptor)
  // =========================
  function signatureOf(json) {
    try {
      const arr = json?.data;
      if (!Array.isArray(arr)) return "";
      // توقيع بسيط باش ما نكرروش نفس الحقن
      return arr.map(x => `${x.Id}:${x.Count}`).join("|");
    } catch {
      return "";
    }
  }

  function onSlotsResponse(json) {
    try {
      // منع إعادة الحقن بنفس الداتا
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

    // ✅ يوم عشوائي
    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    STATE.pickedDay = picked.DateText;
    log("Picked random day:", STATE.pickedDay);

    // ✅ DatePicker الحقيقي
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // ✅ حضّر ddl من اللول
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const o = findRealSlotDDL();
    if (o) {
      STATE.ddl = o.ddl;
      STATE.ddlInput = o.inp;
      patchSiteOnSlotOpen();
      bindKeepSelectionHandlers(STATE.ddl);
      log("Slot DDL prepared:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
    }

    // ✅ حقن التاريخ -> الموقع يرسل GetAvailableSlotsByDate بوحدو
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, STATE.pickedDay)) return;
  })().catch(e => warn("Fatal", e));

})();

