(() => {
  "use strict";

  // 🔒 خليه عام: انت حدّد شرط الصفحة فمشروعك
  // if (!/\/your-page/i.test(location.pathname)) return;

  if (window.__KENDO_AUTO_MERGED__) return;
  window.__KENDO_AUTO_MERGED__ = true;

  const log  = (...a) => console.log("%c[KENDO-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[KENDO-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  async function waitFor(pred, maxMs = 20000, stepMs = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { if (await pred()) return true; } catch {}
      await sleep(stepMs);
    }
    return false;
  }

  async function waitForJqKendo(maxMs = 20000) {
    const ok = await waitFor(() => window.jQuery && window.kendo, maxMs);
    return !!ok;
  }

  function findRealDatePicker() {
    if (!window.jQuery) return null;
    const $ = window.jQuery;

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

    // fallback: أي input عندو instance
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

    // حاول تلقى ddl visible
    const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (!ddl) continue;
      const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
      if (wrap && isVisible(wrap)) return { inp: x, ddl };
    }
    // fallback: أي ddl
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (ddl) return { inp: x, ddl };
    }
    return null;
  }

  function setDateWithKendo(dp, inp, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    try {
      dp.value(dateObj);
      dp.trigger("change");     // يخلي السيستم يدير اللي كيديرو فـ change
      dp.element?.trigger?.("change");
      log("Date set:", dateText);
      return true;
    } catch (e) {
      warn("Kendo set date failed, fallback input events", e);
    }

    try {
      inp.value = dateText;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      log("Date set via input:", dateText);
      return true;
    } catch (e) {
      warn("Input set date failed", e);
      return false;
    }
  }

  function getSlotsArray(ddl) {
    try {
      const ds = ddl.dataSource;
      const data = ds && typeof ds.data === "function" ? ds.data() : null;
      if (!data) return [];
      return data.toJSON ? data.toJSON() : Array.from(data);
    } catch {
      return [];
    }
  }

  async function waitForSlotsAny(ddl, maxMs = 20000) {
    const ok = await waitFor(() => getSlotsArray(ddl).length > 0, maxMs, 120);
    return ok ? getSlotsArray(ddl) : null;
  }

  function pickBestByCount(items) {
    const valid = (items || []).filter(x => Number(x?.Count) > 0);
    if (!valid.length) return null;
    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    return valid[0];
  }

  function injectSlotValue(ddl, best) {
    if (!best) return false;
    try {
      ddl.value(String(best.Id));
      ddl.trigger("change");
      log("Slot injected:", best.Name, "Count:", best.Count, "Id:", best.Id);
      return true;
    } catch (e) {
      warn("inject slot failed", e);
      return false;
    }
  }

  // ✅ إذا الموقع كيعمر slotDataSource خارج ddl وكيحطها غير فـ open
  function ensureDDLHasSlotDataSource(ddl) {
    try {
      // إذا عندك global variable فموقعك بحال slotDataSource:
      if (window.slotDataSource && typeof ddl.setDataSource === "function") {
        ddl.setDataSource(window.slotDataSource);
        return true;
      }
    } catch {}
    return false;
  }

  // ====== غيّر هاد الدالة حسب منطق “الأيام المتاحة” فموقعك ======
  function pickDay() {
    // مثال: إذا عندك window.availDates.ad بحال ما وريتي
    const a = window.availDates?.ad;
    if (!Array.isArray(a)) return "";
    const avail = a.filter(d => d && d.DateText && (d.AppointmentDateType === 0 || d.AppointmentDateType === "0"));
    if (!avail.length) return "";
    const r = avail[Math.floor(Math.random() * avail.length)];
    return r.DateText;
  }

  (async () => {
    if (!await waitForJqKendo()) return warn("jQuery/Kendo not ready");

    // 1) لقي DatePicker الحقيقي
    const dpOk = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!dpOk) return warn("DatePicker not found");
    const dpObj = findRealDatePicker();

    // 2) اختار يوم وحقنو
    const day = pickDay();
    if (!day) return warn("No day to pick");
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, day)) return;

    // 3) لقي Slot DDL الحقيقي
    const ddlOk = await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    if (!ddlOk) return warn("Slot DDL not found");
    const slotObj = findRealSlotDDL();

    // 4) خليه يربط datasource إذا كانت كتوضع غير فـ open
    ensureDDLHasSlotDataSource(slotObj.ddl);

    // 5) تسنّى الداتا (GetAvailableSlotsByDate ولا أي مصدر ديالك) حتى تتعمر
    const items = await waitForSlotsAny(slotObj.ddl, 20000);
    if (!items) return warn("Slots not loaded");

    // 6) اختار أفضل Count>0 وحقنو بلا ما تفتح dropdown
    const best = pickBestByCount(items);
    if (!best) return warn("No slots Count>0");
    injectSlotValue(slotObj.ddl, best);
  })().catch(e => warn("Fatal", e));
})();
