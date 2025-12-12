(() => {
  "use strict";

  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_STABLE) return;
  window.__cal_auto_pick_day_slot_STABLE = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // ✅ إذا بغيتي 0 مايبانوش نهائياً خليه true
  const REMOVE_ZERO_FROM_LIST = true;

  const STATE = {
    pickedDay: "",
    bestId: null,
    bestText: "",
    ddl: null,
    ddlInput: null,
    idToCount: new Map(),
    idToBaseName: new Map(),
    interceptorInstalled: false,
    handlersBound: false,
    lastRespSig: "",
    rafLock: false
  };

  function rafOnce(fn){
    if (STATE.rafLock) return;
    STATE.rafLock = true;
    requestAnimationFrame(() => {
      STATE.rafLock = false;
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
    } catch {}

    try {
      inp.value = dateText;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      log("Date injected via input events:", dateText);
      return true;
    } catch {
      return false;
    }
  }

  // =========================
  // 6) Helpers: update UI without changing DataSource
  // =========================
  function baseName(name) {
    return String(name || "").replace(/\s*\(count\s*:\s*\d+\)\s*$/i, "").trim();
  }

  function forceSetDropDownDisplay(ddl, displayText) {
    try {
      const wrap = ddl.wrapper?.[0];
      const kInput = wrap ? wrap.querySelector("span.k-input") : null;
      if (kInput && displayText) kInput.textContent = displayText;
    } catch {}
  }

  function pickBestIdFromMaps() {
    let bestId = null;
    let bestCount = -1;
    for (const [id, c] of STATE.idToCount.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestId = id;
      }
    }
    return (bestCount > 0) ? bestId : null;
  }

  function applyCountsToDataSourceText(ddl) {
    try {
      const ds = ddl.dataSource;
      if (!ds || typeof ds.data !== "function") return;

      const items = ds.data(); // Kendo ObservableArray
      for (const it of items) {
        const id = String(it.Id ?? it.id ?? it.Value ?? it.value ?? "");
        if (!id) continue;

        const c = STATE.idToCount.has(id) ? STATE.idToCount.get(id) : null;
        if (c == null) continue;

        const bn = STATE.idToBaseName.get(id) || baseName(it.Name);
        STATE.idToBaseName.set(id, bn);

        const disp = `${bn} (count : ${c})`;

        // ✅ غير بدل النص (ماشي object)
        try { it.set ? it.set("Name", disp) : (it.Name = disp); } catch {}
      }

      // تحديث خفيف (بلا ddl.setDataSource)
      ds.trigger("change");
    } catch {}
  }

  function hideZeroItemsInListDom(ddl) {
    try {
      if (!ddl || !ddl.ul || !ddl.ul[0]) return;
      const ul = ddl.ul[0];
      const lis = ul.querySelectorAll("li.k-item");
      lis.forEach(li => {
        let id = null;
        try {
          const di = ddl.dataItem(li);
          if (di && di.Id != null) id = String(di.Id);
        } catch {}

        if (!id) return;

        const c = STATE.idToCount.has(id) ? STATE.idToCount.get(id) : 0;
        if (REMOVE_ZERO_FROM_LIST && c <= 0) {
          li.style.display = "none";
        } else {
          li.style.display = "";
        }
      });
    } catch {}
  }

  function reselectKeep(ddl) {
    try {
      if (!ddl) return;

      // إذا مازال ما اخترناش: اختار أحسن كاونت
      if (!STATE.bestId) {
        const bestId = pickBestIdFromMaps();
        if (bestId) STATE.bestId = bestId;
      }

      if (!STATE.bestId) return;

      // ثبت القيمة
      ddl.value(String(STATE.bestId));
      ddl.trigger("change");

      // ثبت النص اللي فـ input
      const c = STATE.idToCount.get(String(STATE.bestId)) || 0;
      const bn = STATE.idToBaseName.get(String(STATE.bestId)) || "";
      STATE.bestText = bn ? `${bn} (count : ${c})` : (STATE.bestText || "");
      if (STATE.bestText) forceSetDropDownDisplay(ddl, STATE.bestText);
    } catch {}
  }

  // =========================
  // 7) Bind events (lightweight, no lag)
  // =========================
  function bindHandlers(ddl) {
    if (STATE.handlersBound) return;
    STATE.handlersBound = true;

    ddl.bind("open", () => {
      rafOnce(() => {
        applyCountsToDataSourceText(ddl);
        hideZeroItemsInListDom(ddl);
        reselectKeep(ddl);
      });
    });

    ddl.bind("dataBound", () => {
      rafOnce(() => {
        applyCountsToDataSourceText(ddl);
        hideZeroItemsInListDom(ddl);
        reselectKeep(ddl);
      });
    });

    ddl.bind("change", () => {
      // المستخدم يقدر يختار يدوياً
      setTimeout(() => {
        try {
          const di = ddl.dataItem();
          if (di && di.Id != null) {
            const id = String(di.Id);
            STATE.bestId = id;

            // di.Name فيه count دابا
            STATE.bestText = String(di.Name || "");
            forceSetDropDownDisplay(ddl, STATE.bestText);

            // خزن base name
            const bn = baseName(di.Name);
            if (bn) STATE.idToBaseName.set(id, bn);
          }
        } catch {}
      }, 0);
    });
  }

  // =========================
  // 8) XHR response handling
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

      if (!json?.success || !Array.isArray(json.data)) return;

      // جهّز maps
      STATE.idToCount.clear();
      for (const x of json.data) {
        const id = String(x?.Id ?? "");
        if (!id) continue;
        const c  = Number(x?.Count) || 0;

        // خزن count
        STATE.idToCount.set(id, c);

        // خزن base name
        const bn = baseName(x?.Name);
        if (bn) STATE.idToBaseName.set(id, bn);
      }

      if (!STATE.ddl) {
        const o = findRealSlotDDL();
        if (!o) return warn("Slot DDL not found");
        STATE.ddl = o.ddl;
        STATE.ddlInput = o.inp;
        bindHandlers(STATE.ddl);
        log("Slot DDL ready:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
      }

      rafOnce(() => {
        // ✅ غير بدّل النص داخل DS الأصلي
        applyCountsToDataSourceText(STATE.ddl);

        // ✅ إخفاء 0 (DOM فقط)
        hideZeroItemsInListDom(STATE.ddl);

        // ✅ اختار أعلى كاونت (كما النسخة القديمة)
        const bestId = pickBestIdFromMaps();
        if (bestId) {
          STATE.bestId = bestId;
          const c = STATE.idToCount.get(bestId) || 0;
          const bn = STATE.idToBaseName.get(bestId) || "";
          STATE.bestText = bn ? `${bn} (count : ${c})` : "";
          reselectKeep(STATE.ddl);
          log("Slot selected:", STATE.bestText, "Id:", bestId, "Count:", c);
        }
      });

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
  // 9) BOOT
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

    // حضّر ddl من اللول
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const o = findRealSlotDDL();
    if (o) {
      STATE.ddl = o.ddl;
      STATE.ddlInput = o.inp;
      bindHandlers(STATE.ddl);
      log("Slot DDL prepared:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
    }

    // DatePicker الحقيقي
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // حقن التاريخ -> الموقع يرسل GetAvailableSlotsByDate
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, STATE.pickedDay)) return;
  })().catch(e => warn("Fatal", e));

})();
