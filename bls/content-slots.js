(() => {
  "use strict";

  // ✅ غير بدل الشرط حسب صفحتك
  if (!/\/mar\/appointment\/slotselection/i.test(location.pathname)) return;

  if (window.__CAL_READ_RESPONSE_V1__) return;
  window.__CAL_READ_RESPONSE_V1__ = true;

  const log  = (...a) => console.log("%c[CAL-RESP]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-RESP]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  async function waitFor(pred, maxMs = 20000, stepMs = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { if (pred()) return true; } catch {}
      await sleep(stepMs);
    }
    return false;
  }

  async function waitForJqKendo() {
    return waitFor(() => window.jQuery && window.kendo, 20000, 80);
  }

  // =========================
  // DAYS from availDates (random)
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
  // Find REAL DatePicker
  // =========================
  function findRealDatePicker() {
    const $ = window.jQuery;

    const wrappers = Array.from(document.querySelectorAll(".k-datepicker, .k-widget.k-datepicker, .k-picker-wrap"));
    for (const w of wrappers) {
      const wrap = w.classList.contains("k-picker-wrap")
        ? w.closest(".k-datepicker, .k-widget.k-datepicker")
        : w;
      if (!wrap) continue;

      const inp = wrap.querySelector('input[data-role="datepicker"], input.k-input');
      if (!inp || inp.disabled) continue;

      const dp = $(inp).data("kendoDatePicker") || $(wrap).data("kendoDatePicker");
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

  function setDateWithKendo(dpObj, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    try {
      dpObj.dp.value(dateObj);
      dpObj.dp.trigger("change");
      dpObj.dp.element?.trigger?.("change");
      log("Date injected:", dateText);
      return true;
    } catch (e) {
      warn("Date inject failed", e);
      return false;
    }
  }

  // =========================
  // Find Slot DropDownList
  // =========================
  function findRealSlotDDL() {
    const $ = window.jQuery;

    // جرّب ID معروف إذا كاين
    const known = document.querySelector('input[data-role="dropdownlist"]#AppointmentSlot, input[data-role="dropdownlist"][name="AppointmentSlot"]');
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
  // Slots: filter + label + best
  // =========================
  function normalizeSlotsFromResponse(resp) {
    // كاينين مواقع كيرجعو {success:true,data:[...]} و كاينين كيرجعو [...] مباشرة
    const arr = Array.isArray(resp) ? resp : (Array.isArray(resp?.data) ? resp.data : []);
    return arr
      .map(x => ({ ...x, Count: Number(x?.Count) || 0 }))
      .filter(x => x.Count > 0)
      .map(x => ({
        ...x,
        __calLabel: `${String(x.Name || "").trim()} (count : ${Number(x.Count) || 0})`
      }));
  }

  function pickBest(items) {
    if (!items.length) return null;
    items.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    return items[0];
  }

  function applySlotsToDDL(ddl, itemsFiltered) {
    if (!itemsFiltered.length) {
      try {
        ddl.setDataSource([]);
        ddl.refresh();
        ddl.value("");
      } catch {}
      warn("No slots Count>0");
      return;
    }

    // ✅ خلي الـ label يظهر فالدروب + فالعنوان
    try {
      ddl.setOptions({ dataTextField: "__calLabel", dataValueField: "Id" });
    } catch {}

    try {
      ddl.setDataSource(itemsFiltered);
      ddl.refresh();

      const best = pickBest(itemsFiltered);
      if (!best) return;

      ddl.value(String(best.Id));
      ddl.trigger("change");

      // باش يتبدل النص فـ span.k-input مباشرة
      try { ddl.text(best.__calLabel); } catch {}

      log("Best slot injected:", best.__calLabel, "Id:", best.Id);
    } catch (e) {
      warn("applySlotsToDDL failed", e);
    }
  }

  // =========================
  // ✅ READ RESPONSE via dataSource.requestEnd
  // =========================
  function hookReadResponse(slotObj) {
    const ddl = slotObj.ddl;
    const ds  = ddl.dataSource;
    if (!ds || ds.__calHooked) return;
    ds.__calHooked = true;

    ds.bind("requestEnd", (e) => {
      // e.response = نفس JSON اللي رجّع السيرفر
      try {
        const resp = e.response;
        const filtered = normalizeSlotsFromResponse(resp);
        applySlotsToDDL(ddl, filtered);
      } catch (err) {
        warn("requestEnd parse error", err);
      }
    });

    // احتياط: بعض النسخ كتعمر dataSource بلا requestEnd واضح
    ddl.bind("dataBound", () => {
      try {
        const data = ds.data();
        const arr = data?.toJSON ? data.toJSON() : Array.from(data || []);
        const filtered = arr
          .map(x => ({ ...x, Count: Number(x?.Count) || 0 }))
          .filter(x => x.Count > 0)
          .map(x => ({ ...x, __calLabel: `${String(x.Name||"").trim()} (count : ${Number(x.Count)||0})` }));

        // إلا كان الموقع عمرها وكتبان فيها 0s: نعاود نطبّق الفلترة
        if (filtered.length) applySlotsToDDL(ddl, filtered);
      } catch {}
    });

    log("Hooked requestEnd + dataBound on Slot dataSource");
  }

  // =========================
  // BOOT
  // =========================
  (async () => {
    if (!await waitForJqKendo()) return warn("jQuery/Kendo not ready");

    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    log("Picked random day:", picked.DateText);

    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // جهّز ddl و hook قبل ما تحقن التاريخ باش أول response يتقرا
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const slotObj = findRealSlotDDL();
    if (!slotObj) return warn("Slot DDL not found");

    hookReadResponse(slotObj);

    // حقن تاريخ عشوائي → الموقع غادي يرسل GetAvailableSlotsByDate
    setDateWithKendo(dpObj, picked.DateText);
  })().catch(e => warn("Fatal", e));
})();
