(() => {
  "use strict";

  // ✅ بدّل الشرط حسب URL ديال موقعك
  if (!/\/appointment\/slotselection/i.test(location.pathname)) return;

  if (window.__CAL_KENDO_PICKER_V3__) return;
  window.__CAL_KENDO_PICKER_V3__ = true;

  const log  = (...a) => console.log("%c[CAL-KENDO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-KENDO]", ...a);
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
  // 1) DAYS (availDates)
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
  // 2) Find REAL DatePicker
  // =========================
  function findRealDatePicker() {
    const $ = window.jQuery;

    // wrappers ديال Kendo
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

    // fallback: أي input عندو instance وباين
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
      dpObj.dp.trigger("change");            // ✅ يخلي الموقع يدير AJAX ديالو
      dpObj.dp.element?.trigger?.("change");
      log("Date injected:", dateText);
      return true;
    } catch (e) {
      warn("Date inject failed", e);
      try {
        dpObj.inp.value = dateText;
        dpObj.inp.dispatchEvent(new Event("input", { bubbles: true }));
        dpObj.inp.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch (e2) {
        warn("Date fallback failed", e2);
        return false;
      }
    }
  }

  // =========================
  // 3) Find Slot DropDownList
  // =========================
  function findRealSlotDDL() {
    const $ = window.jQuery;

    // إذا عندك ID معروف استعملو
    const known = document.querySelector('input[data-role="dropdownlist"]#AppointmentSlot, input[data-role="dropdownlist"][name="AppointmentSlot"]');
    if (known) {
      const ddl = $(known).data("kendoDropDownList");
      if (ddl) return { inp: known, ddl };
    }

    // خذ اللي wrapper ديالو باين
    const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (!ddl) continue;
      const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
      if (wrap && isVisible(wrap)) return { inp: x, ddl };
    }

    // fallback: أي واحد
    for (const x of all) {
      const ddl = $(x).data("kendoDropDownList");
      if (ddl) return { inp: x, ddl };
    }
    return null;
  }

  // =========================
  // 4) Slots logic:
  //    - remove Count=0
  //    - add "(count:x)"
  //    - select best Count (no open)
  // =========================
  function normalizeSlots(arr) {
    const items = Array.isArray(arr) ? arr : [];
    // keep Count>0 فقط
    const ok = items
      .map(x => ({ ...x, Count: Number(x?.Count) || 0 }))
      .filter(x => x.Count > 0);

    // add display label
    ok.forEach(x => {
      const baseName = (x.Name ?? "").trim();
      x.__calLabel = `${baseName} (count : ${x.Count})`;
    });

    return ok;
  }

  function pickBest(items) {
    if (!items.length) return null;
    items.sort((a,b) => (b.Count||0) - (a.Count||0));
    return items[0];
  }

  function applySlotsToDDL(slotObj, rawItems) {
    const ddl = slotObj.ddl;
    const filtered = normalizeSlots(rawItems);

    if (!filtered.length) {
      warn("No slots Count>0 (after filtering)");
      try {
        ddl.setDataSource([]); // hide all
        ddl.refresh();
        ddl.value("");
      } catch {}
      return;
    }

    // ✅ أهم نقطة: نخلي ddl يستعمل labels ديالنا
    try {
      // نبدّل text field مؤقتاً لــ __calLabel
      ddl.setOptions({ dataTextField: "__calLabel", dataValueField: "Id" });
    } catch {}

    try {
      ddl.setDataSource(filtered);
      ddl.refresh();

      const best = pickBest(filtered);
      if (!best) return;

      // ✅ الحقن الحقيقي بلا فتح dropdown
      ddl.value(String(best.Id));
      ddl.trigger("change");

      // باش يبان النص مباشرة فـ span.k-input
      try { ddl.text(best.__calLabel); } catch {}

      log("Selected best slot:", best.__calLabel, "Id:", best.Id);
    } catch (e) {
      warn("applySlotsToDDL failed", e);
    }
  }

  // =========================
  // 5) Hook on dataBound (when site loads slots)
  // =========================
  function hookDDLDataBound(slotObj) {
    const ddl = slotObj.ddl;
    if (ddl.__calHooked) return;
    ddl.__calHooked = true;

    const handler = () => {
      try {
        const ds = ddl.dataSource;
        const data = ds && typeof ds.data === "function" ? ds.data() : null;
        const items = data ? (data.toJSON ? data.toJSON() : Array.from(data)) : [];
        if (!items || !items.length) return;

        // كل مرة كيتبدل التاريخ كيتعمّر الداتا: نطبّق الفلترة+النص+best
        applySlotsToDDL(slotObj, items);
      } catch (e) {}
    };

    // Kendo event
    ddl.bind("dataBound", handler);

    // في بعض الصفحات dataBound ماكيطلقش إلا open:
    // ندير poll خفيف يراقب تغيّر طول الداتا
    let lastLen = -1;
    setInterval(() => {
      try {
        const ds = ddl.dataSource;
        const data = ds && typeof ds.data === "function" ? ds.data() : null;
        const len = data ? data.length : 0;
        if (len > 0 && len !== lastLen) {
          lastLen = len;
          handler();
        }
      } catch {}
    }, 120);
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

    // حضّر ddl قبل ما تحقن التاريخ
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const slotObj = findRealSlotDDL();
    if (slotObj) {
      hookDDLDataBound(slotObj);
      log("Slot DDL hooked:", slotObj.inp?.id || slotObj.inp?.name || "(unknown)");
    } else {
      warn("Slot DDL not found");
    }

    // حقن تاريخ عشوائي (الموقع هو اللي كيجلب الساعات)
    setDateWithKendo(dpObj, picked.DateText);
  })().catch(e => warn("Fatal", e));
})();
