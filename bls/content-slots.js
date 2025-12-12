(() => {
  "use strict";

  // فقط SlotSelection
  if (!/\/mar\/appointment\/slotselection/i.test(location.pathname)) return;
  if (window.__cal_slot_auto_started_v2) return;
  window.__cal_slot_auto_started_v2 = true;

  const log  = (...a) => console.log("%c[SLOT-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[SLOT-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

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

  async function waitForJqKendo(maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.jQuery && window.kendo) return true;
      await sleep(80);
    }
    return false;
  }

  // ✅ أقوى استخراج لـ DatePicker الحقيقي
  function findRealDatePicker() {
    if (!window.jQuery) return null;
    const $ = window.jQuery;

    // 1) جرّب wrappers ديال Kendo DatePicker
    const wrappers = Array.from(document.querySelectorAll(".k-datepicker, .k-widget.k-datepicker, .k-picker-wrap"));
    for (const w of wrappers) {
      const wrap = w.classList.contains("k-picker-wrap") ? w.closest(".k-datepicker, .k-widget.k-datepicker") : w;
      if (!wrap) continue;
      const inp = wrap.querySelector('input[data-role="datepicker"], input.k-input');
      if (!inp || inp.disabled) continue;

      // حاول instance من wrapper أو input
      let dp = $(inp).data("kendoDatePicker") || $(wrap).data("kendoDatePicker");
      if (!dp && window.kendo?.widgetInstance) {
        try { dp = window.kendo.widgetInstance($(wrap)); } catch {}
      }
      if (dp) {
        // الأفضل يكون هو اللي باين
        if (isVisible(wrap) || isVisible(inp)) return { inp, dp, wrap };
      }
    }

    // 2) fallback: أي input datepicker عندو instance
    const inputs = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    for (const inp of inputs) {
      if (inp.disabled) continue;
      const dp = $(inp).data("kendoDatePicker");
      if (dp && isVisible(inp)) return { inp, dp, wrap: inp.closest(".k-datepicker, .k-widget.k-datepicker") };
    }

    return null;
  }

  function findRealSlotDDL() {
    if (!window.jQuery) return null;
    const $ = window.jQuery;

    // المفضل AppointmentSlot
    const inp1 = document.querySelector('input#AppointmentSlot[data-role="dropdownlist"], input[name="AppointmentSlot"][data-role="dropdownlist"]');
    if (inp1) {
      const ddl = $(inp1).data("kendoDropDownList");
      if (ddl) return { inp: inp1, ddl };
    }

    // fallback: أول ddl باين wrapper ديالو
    const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (!ddl) continue;
      const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
      if (wrap && isVisible(wrap)) return { inp: x, ddl };
    }

    // آخر fallback
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (ddl) return { inp: x, ddl };
    }
    return null;
  }

  async function waitForDatePickerInstance(maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const dp = findRealDatePicker();
      if (dp) return dp;
      await sleep(120);
    }
    return null;
  }

  async function waitForSlotsLoaded(ddl, maxMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const ds = ddl.dataSource;
        const data = ds && typeof ds.data === "function" ? ds.data() : null;
        if (data && data.length) return data.toJSON ? data.toJSON() : Array.from(data);
      } catch {}
      await sleep(120);
    }
    return null;
  }

  function setDateWithKendo(dp, inp, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    try {
      dp.value(dateObj);
      dp.trigger("change");       // ✅ يخلي الموقع يدير AJAX ديالو
      dp.element?.trigger?.("change");
      log("Date injected via Kendo:", dateText);
      return true;
    } catch (e) {
      warn("Kendo set date failed, fallback to input events", e);
    }

    // fallback events
    try {
      inp.value = dateText;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      log("Date injected via input events:", dateText);
      return true;
    } catch (e) {
      warn("Input fallback failed", e);
    }
    return false;
  }

  function pickBestSlotAndSet(ddl, items) {
    const valid = (items || []).filter(x => Number(x?.Count) > 0);
    if (!valid.length) return null;

    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    const best = valid[0];

    try {
      ddl.value(String(best.Id));
      ddl.trigger("change"); // ✅ حقن فـ input الحقيقي
      log("Best slot selected:", best.Name, "Count:", best.Count, "Id:", best.Id);
      return best;
    } catch (e) {
      warn("Set slot failed", e);
      return null;
    }
  }

  (async () => {
    const ready = await waitForJqKendo();
    if (!ready) return warn("jQuery/Kendo not ready (timeout)");

    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates");

    const picked = pickRandom(days);
    log("Picked day:", picked.DateText);

    // ✅ تسنّى حتى يبان instance ديال DatePicker الحقيقي
    const dpObj = await waitForDatePickerInstance();
    if (!dpObj) return warn("Real DatePicker still not found بعد الانتظار");

    const ok = setDateWithKendo(dpObj.dp, dpObj.inp, picked.DateText);
    if (!ok) return;

    // دابا تسنّى الساعات تجي
    const slotObj = findRealSlotDDL();
    if (!slotObj) return warn("Slot DropDownList not found");

    const items = await waitForSlotsLoaded(slotObj.ddl);
    if (!items) return warn("Slots not loaded (timeout)");

    const best = pickBestSlotAndSet(slotObj.ddl, items);
    if (!best) warn("No slot Count>0");
  })().catch(e => warn("Fatal", e));
})();
