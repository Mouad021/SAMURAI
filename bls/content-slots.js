(() => {
  "use strict";

  // ✅ بدّلها حسب صفحة موقعك
  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_v2) return;
  window.__cal_auto_pick_day_slot_v2 = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  // ✅ بدّل regex ديال endpoint إذا مختلف فموقعك
  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // =========================
  // 1) availDates (نفس المتغير اللي عطيت)
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

    // fallback: input visible عندو instance
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

    // إذا كان عندك id معروف خليه أول اختيار (بدّل إذا عندك id آخر)
    const known = document.querySelector('input#AppointmentSlot[data-role="dropdownlist"]');
    if (known) {
      const ddl = $(known).data("kendoDropDownList");
      if (ddl) return { inp: known, ddl };
    }

    // خذ ddl اللي wrapper ديالو باين
    const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (!ddl) continue;
      const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
      if (wrap && isVisible(wrap)) return { inp: x, ddl };
    }

    // fallback: أول ddl
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (ddl) return { inp: x, ddl };
    }
    return null;
  }

  // =========================
  // 5) حقن التاريخ (يخلي الموقع يدير AJAX ديالو)
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

    // fallback events
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

  const HIDE_ZERO_SLOTS = true;
  
  // =========================
  // 6) تجهيز الساعات: إضافة (count:x) + (اختياري) حذف 0
  // =========================
  function normalizeSlots(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];
  
    const all = json.data.map(x => ({
      ...x,
      // مهم: خليه رقم و خليه حاضر حتى فـ template
      Count: Number(x?.Count) || 0,
      // مهم: خليه string باش يتطابق مع ddl.value()
      Id: String(x?.Id ?? ""),
    }));
  
    const list = HIDE_ZERO_SLOTS ? all.filter(x => x.Count > 0) : all;
  
    return list.map(x => ({
      ...x,
      __DisplayName: `${x.Name} (count : ${x.Count})`
    }));
  }


  function pickBestSlot(items) {
    const valid = (items || []).filter(x => Number(x?.Count) > 0);
    if (!valid.length) return null;
    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    return valid[0];
  }

  // =========================
  // 7) حقن الساعة “بحال الموقع” (k-input) بلا فتح
  // =========================
  function forceSetDropDownDisplay(ddl, displayText) {
    // هذا هو اللي كيبان فـ الصورة (span.k-input)
    try {
      const wrap = ddl.wrapper?.[0];
      const kInput = wrap ? wrap.querySelector("span.k-input") : null;
      if (kInput && displayText) kInput.textContent = displayText;
    } catch {}
  }

  function injectSlotsAndSelectBest(ddl, itemsWithDisplay) {
    if (!ddl) return;
  
    const best = pickBestSlot(itemsWithDisplay);
    if (!best) {
      warn("No available slots (Count>0)");
      return;
    }
  
    try {
      // نخلي Name هو اللي كيبان فـ اللائحة (باش li يبان فيه count)
      const dataForDS = itemsWithDisplay.map(x => ({
        ...x,
        Id: String(x.Id),
        Count: Number(x.Count) || 0,
        Name: x.__DisplayName || `${x.Name} (count : ${x.Count})`,
      }));
  
      const ds = new window.kendo.data.DataSource({ data: dataForDS });
  
      ddl.setDataSource(ds);
      ddl.refresh();
  
      // ✅ مهم: نخلي Kendo يكمّل bind قبل select
      ds.fetch(() => {
        const data = ddl.dataSource.data();
        const bestId = String(best.Id);
  
        const idx = data.findIndex(d => String(d.Id) === bestId);
        if (idx < 0) {
          warn("Best slot not found inside DataSource for select()", bestId);
          return;
        }
  
        // ✅ هادي هي “بحال الدالة القديمة” وكتثبت الاختيار
        ddl.select(idx);
        ddl.trigger("change");
  
        // ✅ خليه يبان فـ span.k-input بنفس displayName
        const chosen = data[idx];
        const shown = chosen?.Name || (best.__DisplayName || `${best.Name} (count : ${best.Count})`);
        try { ddl.text(shown); } catch {}
        forceSetDropDownDisplay(ddl, shown);
  
        log("Slot selected:", shown, "Id:", bestId, "Count:", best.Count);
      });
  
    } catch (e) {
      warn("injectSlotsAndSelectBest failed", e);
    }
  }
  


  // =========================
  // 8) قراءة ريسبونس GetAvailableSlotsByDate (XHR فقط باش مانكسروش jq.ajax)
  // =========================
  let __ddlObj = null;

  function onSlotsResponse(json) {
    try {
      const items = normalizeSlots(json); // هنا تحيد 0 وتزيد (count:x)
      if (!items.length) return warn("Slots response had no Count>0 items");

      if (!__ddlObj) __ddlObj = findRealSlotDDL();
      if (!__ddlObj) return warn("Slot DDL not found");

      injectSlotsAndSelectBest(__ddlObj.ddl, items);
    } catch (e) {
      warn("onSlotsResponse error", e);
    }
  }

  function installXHRInterceptor() {
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

    // ✅ ركب interceptor قبل ما نبدلو التاريخ
    installXHRInterceptor();

    // ✅ نهار عشوائي
    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    const pickedDay = picked.DateText;
    log("Picked random day:", pickedDay);

    // ✅ DatePicker الحقيقي
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // ✅ حقن النهار -> الموقع غادي يدير AJAX ديالو بوحدو
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, pickedDay)) return;

    // حضّر ddl باش منين تجي الداتا نحقنو بسرعة
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    __ddlObj = findRealSlotDDL();
    if (__ddlObj) log("Slot DDL ready:", __ddlObj.inp?.id || __ddlObj.inp?.name || "(unknown)");
  })().catch(e => warn("Fatal", e));

})();




