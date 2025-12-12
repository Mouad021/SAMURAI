(() => {
  "use strict";

  // ✅ خليه خدام غير فـ SlotSelection
  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_v1) return;
  window.__cal_auto_pick_day_slot_v1 = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  // =========================
  // 1) availDates (نفس المتغير)
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
  // 3) لقّي DatePicker الحقيقي (ماشي المزيفين)
  // =========================
  function findRealDatePicker() {
    if (!window.jQuery) return null;
    const $ = window.jQuery;

    // wrappers Kendo DatePicker
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

      // ✅ خذ غير اللي باين/فعال
      if (dp && (isVisible(wrap) || isVisible(inp))) return { inp, dp, wrap };
    }

    // fallback: أي input عندو instance و باين
    const inputs = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    for (const inp of inputs) {
      if (inp.disabled) continue;
      const dp = $(inp).data("kendoDatePicker");
      if (dp && isVisible(inp)) return { inp, dp, wrap: inp.closest(".k-datepicker, .k-widget.k-datepicker") };
    }

    return null;
  }

  // =========================
  // 4) لقّي Slot DropDownList الحقيقي (input hidden data-role="dropdownlist")
  // =========================
  function findRealSlotDDL() {
    if (!window.jQuery) return null;
    const $ = window.jQuery;

    // إذا عندك id معروف فموقعك (بحال "AppointmentSlot") جرّبو أولاً:
    const known = document.querySelector('input#AppointmentSlot[data-role="dropdownlist"]');
    if (known) {
      const ddl = $(known).data("kendoDropDownList");
      if (ddl) return { inp: known, ddl };
    }

    // ✅ اختار ddl اللي wrapper ديالو باين
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

  // =========================
  // 5) حقن اليوم فـ Kendo DatePicker (باش الموقع يدير AJAX)
  // =========================
  function setDateWithKendo(dp, inp, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    try {
      dp.value(dateObj);
      dp.trigger("change");              // ✅ هذا هو اللي كيخلي الموقع يرسل GetAvailableSlotsByDate
      dp.element?.trigger?.("change");
      log("Date injected:", dateText);
      return true;
    } catch (e) {
      warn("Kendo date inject failed", e);
    }

    // fallback
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
  // 6) اختيار أحسن Slot (أعلى Count) وحقنو بلا فتح dropdown
  // =========================
  function pickBestSlot(items) {
    const valid = (items || []).filter(x => Number(x?.Count) > 0);
    if (!valid.length) return null;
    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    return valid[0];
  }

  function injectSlotWithoutOpen(ddl, items) {
    const best = pickBestSlot(items);
    if (!best) {
      warn("No available slots (Count>0)");
      return false;
    }

    try {
      // ✅ الحل ديال: “ما يحقنش حتى نفتح”
      // لأن الموقع كيدير setDataSource فـ OnSlotOpen => حنا كنفرضو datasource دابا
      ddl.setDataSource(items);
      ddl.refresh();

      ddl.value(String(best.Id));
      ddl.trigger("change");

      // ✅ باش يبان النص فـ span.k-input (بحال اللي وريتي)
      try { ddl.text(best.Name); } catch {}

      log("Slot injected:", best.Name, "Count:", best.Count, "Id:", best.Id);
      return true;
    } catch (e) {
      warn("injectSlotWithoutOpen failed", e);
      return false;
    }
  }

  // =========================
  // 7) قراءة ريسبونس GetAvailableSlotsByDate
  // =========================
  function parseSlotsResponse(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];
    // ✅ خذ نفس structure (Name, Id, Count, ...)
    return json.data.map(x => ({ ...x, Count: Number(x.Count) || 0 }));
  }

  // =========================
  // 8) Interceptors: fetch + XHR
  // =========================
  let __pickedDay = "";
  let __ddlObj = null;

  function onSlotsJson(json) {
    try {
      const items = parseSlotsResponse(json);
      if (!items.length) return;

      if (!__ddlObj) __ddlObj = findRealSlotDDL();
      if (!__ddlObj) return warn("Slot DDL not found to inject");

      // ✅ حقن بدون فتح
      injectSlotWithoutOpen(__ddlObj.ddl, items);
    } catch (e) {
      warn("onSlotsJson error", e);
    }
  }

  function installInterceptors() {
    const _fetch = window.fetch?.bind(window);
    if (_fetch) {
      window.fetch = async function(input, init) {
        const url = (typeof input === "string") ? input : (input && input.url) ? input.url : "";
        const res = await _fetch(input, init);

        try {
          if (/GetAvailableSlotsByDate/i.test(url)) {
            const clone = res.clone();
            const ct = (clone.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("application/json")) {
              clone.json().then(onSlotsJson).catch(() => {});
            }
          }
        } catch {}
        return res;
      };
    }

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
            if (/GetAvailableSlotsByDate/i.test(url)) {
              const txt = this.responseText || "";
              const j = JSON.parse(txt);
              onSlotsJson(j);
            }
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
    const ok = await waitForJqKendo();
    if (!ok) return warn("jQuery/Kendo not ready (timeout)");

    // ✅ ركّب interceptors قبل ما نحقن اليوم باش نلحقو ريسبونس
    installInterceptors();

    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    __pickedDay = picked.DateText;
    log("Picked random day:", __pickedDay);

    // ✅ لقي DatePicker الحقيقي
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // ✅ حقن اليوم (الموقع غادي يرسل GetAvailableSlotsByDate بوحدو)
    if (!setDateWithKendo(dpObj.dp, dpObj.inp, __pickedDay)) return;

    // ✅ حضّر ddl (اختياري) باش منين تجي الداتا نحقنو مباشرة
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    __ddlObj = findRealSlotDDL();
    if (__ddlObj) log("Slot DDL ready:", __ddlObj.inp?.id || __ddlObj.inp?.name || "(unknown)");

    // ملاحظة: الحقن ديال الساعة كيتدار فـ onSlotsJson ملي كتوصل الداتا
  })().catch(e => warn("Fatal", e));

})();
