(() => {
  "use strict";

  // ====== ONLY SlotSelection ======
  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_slot_auto_started) return;
  window.__cal_slot_auto_started = true;

  const log  = (...a) => console.log("%c[SLOT-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[SLOT-AUTO]", ...a);

  // --------------------------------
  // Helpers
  // --------------------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function getAvailDays() {
    const a = window.availDates?.ad;
    if (!Array.isArray(a)) return [];
    return a.filter(d =>
      d &&
      (d.SingleSlotAvailable === true || d.SingleSlotAvailable === "true") &&
      (d.AppointmentDateType === 0 || d.AppointmentDateType === "0") &&
      d.DateText
    );
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // --------------------------------
  // Find REAL DatePicker (Kendo instance)
  // --------------------------------
  function findRealDatePickerInput() {
    const inputs = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    // خذ اللي باين و ماشي disabled و عندو aria-owns فيه _dateview غالباً
    const candidates = inputs.filter(el =>
      isVisible(el) &&
      !el.disabled &&
      (String(el.getAttribute("aria-owns") || "").includes("_dateview") || el.getAttribute("data-role") === "datepicker")
    );

    // مهم: الحقيقي غالباً كيكون داخل span.k-datepicker / .k-widget.k-datepicker
    for (const inp of candidates) {
      const w = inp.closest(".k-datepicker, .k-widget.k-datepicker");
      if (!w) continue;
      // إذا كان كاين instance ديال kendoDatePicker فهاد input ولا فـ wrapper
      const dp = window.jQuery ? (window.jQuery(inp).data("kendoDatePicker") || window.jQuery(w).data("kendoDatePicker")) : null;
      if (dp) return { inp, dp };
    }

    // fallback: جرّب أي input عندو instance مباشرة
    if (window.jQuery) {
      for (const inp of candidates) {
        const dp = window.jQuery(inp).data("kendoDatePicker");
        if (dp) return { inp, dp };
      }
    }

    return null;
  }

  // --------------------------------
  // Find REAL Slot DropDownList (Kendo instance)
  // --------------------------------
  function findRealSlotDropDown() {
    // غالباً input الأصلي مخفي: input[data-role="dropdownlist"] + نفس id/name
    const inp = document.querySelector('input#AppointmentSlot[data-role="dropdownlist"], input[name="AppointmentSlot"][data-role="dropdownlist"], input[data-role="dropdownlist"]#AppointmentSlot');
    if (inp && window.jQuery) {
      const ddl = window.jQuery(inp).data("kendoDropDownList");
      if (ddl) return { inp, ddl };
    }

    // fallback: قلب على أي dropdownlist باين wrapper ديالو و عندو ddl
    if (window.jQuery) {
      const all = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
      for (const x of all) {
        const ddl = window.jQuery(x).data("kendoDropDownList");
        if (!ddl) continue;
        const wrap = ddl.wrapper?.[0] || x.closest(".k-dropdown, .k-widget.k-dropdown");
        if (wrap && isVisible(wrap)) return { inp: x, ddl };
      }
      // آخر fallback: أول ddl
      for (const x of all) {
        const ddl = window.jQuery(x).data("kendoDropDownList");
        if (ddl) return { inp: x, ddl };
      }
    }

    return null;
  }

  async function waitForKendoReady(maxMs = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.kendo && window.jQuery) return true;
      await sleep(80);
    }
    return false;
  }

  async function waitForSlotsLoaded(ddl, maxMs = 12000) {
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

  function selectBestSlot(ddl, items) {
    const valid = (items || []).filter(x => Number(x?.Count) > 0);
    if (!valid.length) return null;

    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    const best = valid[0];

    // حقن بالقيمة + change (هذا اللي كيمثل “الـ input الحقيقي”)
    ddl.value(String(best.Id));
    ddl.trigger("change");

    return best;
  }

  // --------------------------------
  // MAIN
  // --------------------------------
  (async () => {
    const ok = await waitForKendoReady();
    if (!ok) return warn("Kendo/jQuery not ready");

    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates");

    const pickedDay = pickRandom(days);
    log("Picked day:", pickedDay.DateText);

    const dpObj = findRealDatePickerInput();
    if (!dpObj) return warn("Real DatePicker not found (Kendo instance missing)");

    const { dp } = dpObj;

    // حط التاريخ باستعمال Kendo (مشّي input.value فقط)
    // DateText = "YYYY-MM-DD"
    const [Y, M, D] = String(pickedDay.DateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    dp.value(dateObj);
    dp.trigger("change"); // هادي اللي كتخلي الموقع يدير AJAX ديالو طبيعي
    log("Date injected via kendoDatePicker + change");

    // دابا تسنى حتى يتعبّاو الساعات فـ dropdown
    const slotObj = findRealSlotDropDown();
    if (!slotObj) return warn("Real Slot DropDownList not found");

    const { ddl } = slotObj;

    const items = await waitForSlotsLoaded(ddl);
    if (!items) return warn("Slots not loaded (dataSource empty/timeout)");

    const best = selectBestSlot(ddl, items);
    if (!best) return warn("No slot with Count > 0");

    log("Best slot selected:", { Name: best.Name, Count: best.Count, Id: best.Id });
  })().catch(e => warn("Fatal", e));

})();
