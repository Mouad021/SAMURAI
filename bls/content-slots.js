(() => {
  "use strict";

  // ✅ بدّلها حسب صفحة موقعك
  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_v3) return;
  window.__cal_auto_pick_day_slot_v3 = true;

  const log   = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn  = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  // ✅ بدّل regex ديال endpoint إذا مختلف فموقعك
  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // ============ 1) availDates ============
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

  // ============ 2) انتظار jQuery + Kendo ============
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

  // ============ 3) DatePicker الحقيقي ============
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

  // ============ 4) Slot DropDownList الحقيقي ============
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

  // ============ 5) حقن التاريخ ============
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

  // ============ 6) normalize + اختيار best ============
  function normalizeSlotsFromResponse(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];

    // خليه كيشمل الكل (حتى 0) باش تقدر تبان فالقائمة إذا بغيتي
    // ولكن إحنا غادي نفلتر 0 عبر filter ديال DataSource
    return json.data.map(x => {
      const c = Number(x?.Count) || 0;
      return {
        ...x,
        Count: c,
        __DisplayName: `${x.Name} (count : ${c})`
      };
    });
  }

  function pickBestSlot(items) {
    const valid = (items || []).filter(x => (Number(x?.Count) || 0) > 0);
    if (!valid.length) return null;
    valid.sort((a, b) => (Number(b.Count) || 0) - (Number(a.Count) || 0));
    return valid[0];
  }

  // ============ 7) FORCE template ديال Kendo باش li يبقاو فيهم count ============
  function applySlotTemplates(ddl) {
    try {
      ddl.setOptions({
        dataTextField: "Name",
        dataValueField: "Id",

        // ✅ هادي كتكتب داخل <li>
        template: function (d) {
          const c = Number(d?.Count) || 0;
          const label = (d?.__DisplayName) ? d.__DisplayName : `${d?.Name || ""} (count : ${c})`;
          // استعمل نفس classes ديالك
          const cls = (c > 0) ? "slot-item bg-success" : "slot-item bg-danger";
          // ملاحظة: style خليتو بسيط باش ما نبدلوش ستايلك
          return `<div class="${cls}" style="border-radius:8px;padding:4px 18px;">${label}</div>`;
        },

        // ✅ هادي كتكتب فالـ span.k-input (القيمة المختارة)
        valueTemplate: function (d) {
          if (!d) return "--Select--";
          const c = Number(d?.Count) || 0;
          const label = (d?.__DisplayName) ? d.__DisplayName : `${d?.Name || ""} (count : ${c})`;
          return label;
        }
      });
    } catch (e) {
      warn("applySlotTemplates failed", e);
    }
  }

  // ============ 8) setDataSource “آمن” + فلترة 0 + اختيار best ============
  function setSlotsIntoDDLAndSelect(ddl, items) {
    const best = pickBestSlot(items);
    if (!best) {
      warn("No slot Count>0");
      return;
    }

    try {
      applySlotTemplates(ddl);

      // DataSource (باش filter يخدم)
      const ds = new window.kendo.data.DataSource({
        data: items.map(x => ({
          ...x,
          // نخلي Name الأصلي، وكنستعمل __DisplayName فالـ template
          Name: x.Name
        }))
      });

      // ✅ حذف count=0 نهائياً من اللائحة
      ds.filter({ field: "Count", operator: "gt", value: 0 });

      ddl.setDataSource(ds);

      // مهم: dataBound كيكون هو الوقت المناسب للـ value + text
      ddl.one("dataBound", function () {
        try {
          // اختار best
          ddl.value(String(best.Id));
          ddl.trigger("change");

          // فرض النص المختار (باش ما يرجعش)
          const shown = best.__DisplayName || `${best.Name} (count : ${best.Count})`;
          try { ddl.text(shown); } catch {}
          try {
            const wrap = ddl.wrapper?.[0];
            const kInput = wrap ? wrap.querySelector("span.k-input") : null;
            if (kInput) kInput.textContent = shown;
          } catch {}

          log("Slot selected:", shown, "Id:", best.Id, "Count:", best.Count);
        } catch (e) {
          warn("select best after dataBound failed", e);
        }
      });

      // fetch باش يطلق dataBound
      try { ddl.dataSource.fetch(); } catch { ddl.refresh(); }

    } catch (e) {
      warn("setSlotsIntoDDLAndSelect failed", e);
    }
  }

  // ============ 9) HOOK: باش إلا الموقع دار setDataSource فـ open مايضيعش count/selection ============
  function hookDDLOnce(ddl) {
    if (!ddl || ddl.__cal_hooked) return;
    ddl.__cal_hooked = true;

    applySlotTemplates(ddl);

    const _setDataSource = ddl.setDataSource.bind(ddl);
    ddl.setDataSource = function (dsOrArr) {
      try {
        // إذا جا array، نحولو ل DataSource ونحافظو على template/filter
        let ds = dsOrArr;

        if (Array.isArray(dsOrArr)) {
          const items = dsOrArr.map(x => {
            const c = Number(x?.Count) || 0;
            return { ...x, Count: c, __DisplayName: `${x.Name} (count : ${c})` };
          });
          ds = new window.kendo.data.DataSource({ data: items });
          ds.filter({ field: "Count", operator: "gt", value: 0 });
        } else if (dsOrArr && dsOrArr.data && typeof dsOrArr.data === "function") {
          // إذا DataSource جا من الموقع، نخليو ولكن نطبّق filter (اختياري)
          try { dsOrArr.filter({ field: "Count", operator: "gt", value: 0 }); } catch {}
        }

        applySlotTemplates(ddl);
        return _setDataSource(ds);
      } catch (e) {
        warn("patched setDataSource failed", e);
        return _setDataSource(dsOrArr);
      }
    };

    // كل مرة كتفتح القائمة، نعاودو نطبّق templates ونثبت الاختيار
    ddl.bind("open", function () {
      try {
        applySlotTemplates(ddl);
        const v = ddl.value();
        if (v) ddl.value(v); // يثبت
        ddl.refresh();
      } catch {}
    });

    ddl.bind("dataBound", function () {
      try { applySlotTemplates(ddl); } catch {}
    });

    log("Slot DDL hooked (templates + setDataSource patch)");
  }

  // ============ 10) Interceptor ديال XHR: نقراو ريسبونس الساعات ============
  let __ddlObj = null;

  function onSlotsResponse(json) {
    const items = normalizeSlotsFromResponse(json);
    if (!items.length) return;

    if (!__ddlObj) __ddlObj = findRealSlotDDL();
    if (!__ddlObj) return warn("Slot DDL not found");

    hookDDLOnce(__ddlObj.ddl);
    setSlotsIntoDDLAndSelect(__ddlObj.ddl, items);
  }

  function installXHRInterceptor() {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__cal_url = url;
      return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      try {
        this.addEventListener("load", function () {
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

  // ============ 11) BOOT ============
  (async () => {
    if (!await waitForJqKendo()) return warn("jQuery/Kendo not ready");

    installXHRInterceptor();

    // نهار عشوائي
    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    const pickedDay = picked.DateText;
    log("Picked random day:", pickedDay);

    // DatePicker
    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();

    // حضّر ddl و hook من الأول
    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    __ddlObj = findRealSlotDDL();
    if (__ddlObj?.ddl) hookDDLOnce(__ddlObj.ddl);

    // حقن النهار -> الموقع كيبعث request ديال الساعات
    setDateWithKendo(dpObj.dp, dpObj.inp, pickedDay);
  })().catch(e => warn("Fatal", e));

})();
