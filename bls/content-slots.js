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
  
  function normalizeSlots(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];
    return json.data.map(x => ({
      ...x,
      Id: String(x?.Id ?? ""),
      Count: Number(x?.Count) || 0,
      __baseName: String(x?.Name ?? ""),
      __displayName: `${String(x?.Name ?? "")} (count : ${Number(x?.Count) || 0})`
    }));
  }
  // كتزيّن اللائحة ديال Kendo (li) حسب Count بلا ما نبدلو template الأصلي
  function ensureSlotListDecorators(ddl) {
    if (ddl.__countDecoratorsInstalled) return;
    ddl.__countDecoratorsInstalled = true;
  
    const decorate = () => {
      try {
        const ul = ddl.ul && ddl.ul[0];
        if (!ul) return;
  
        const lis = ul.querySelectorAll("li.k-item");
        lis.forEach(li => {
          const item = ddl.dataItem(li);
          if (!item) return;
  
          const c = Number(item.Count) || 0;
  
          // hide Count=0 (إلا بغيتي)
          if (HIDE_ZERO_SLOTS && c <= 0) {
            li.style.display = "none";
            return;
          } else {
            li.style.display = "";
          }
  
          // غالباً template ديالك كيدير <div class="slot-item ...">TIME</div>
          const slotDiv = li.querySelector(".slot-item");
          const base = (item.__baseName || item.Name || "").toString().replace(/\s*\(count\s*:\s*\d+\)\s*$/i, "");
          const shown = `${base} (count : ${c})`;
  
          if (slotDiv) {
            // بدّل النص داخل slot-item
            slotDiv.textContent = shown;
          } else {
            // fallback: بدّل نص li كامل
            li.textContent = shown;
          }
        });
      } catch {}
    };
  
    // كل مرة كيتبدّل datasource كيتطلق dataBound
    ddl.bind("dataBound", decorate);
    // ووقت open (باش تكون ul تولدت)
    ddl.bind("open", () => setTimeout(decorate, 0));
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

  function injectSlotsAndSelectBest(ddl, itemsRaw) {
    if (!ddl) return;
  
    // ركّب ديكور مرة وحدة باش li ديماً يبانو بالكاونت
    ensureSlotListDecorators(ddl);
  
    // خذ غير اللي Count>0 لاختيار best (حتى إلا ماخبيتيش 0)
    const valid = (itemsRaw || []).filter(x => (Number(x?.Count) || 0) > 0);
    if (!valid.length) {
      warn("No slots Count>0");
      return;
    }
  
    valid.sort((a,b) => (Number(b.Count)||0) - (Number(a.Count)||0));
    const best = valid[0];
    const bestId = String(best.Id);
  
    try {
      // فعل dropdown إذا كان disabl  
      // setDataSource بالداتا الأصلية (ما كنبدلوش template)
      const ds = new window.kendo.data.DataSource({ data: itemsRaw });
      ddl.setDataSource(ds);
      ddl.refresh();
  
      ds.fetch(() => {
        // 🔁 dataSource.data() = Kendo ObservableArray => حولها ل Array
        const obs = ddl.dataSource.data();
        const arr = (obs && typeof obs.toJSON === "function") ? obs.toJSON() : Array.from(obs || []);
      
        const idx = arr.findIndex(d => String(d.Id) === bestId);
      
        if (idx >= 0) {
          ddl.select(idx);     // ✅ هذا كيثبت الاختيار
        } else {
          ddl.value(bestId);   // fallback
        }
      
        ddl.trigger("change");
      
        const chosen = (idx >= 0 ? arr[idx] : best);
        const c = Number(chosen.Count) || 0;
        const base = (chosen.__baseName || chosen.Name || "")
          .toString()
          .replace(/\s*\(count\s*:\s*\d+\)\s*$/i, "");
        const shown = `${base} (count : ${c})`;
      
        try { ddl.text(shown); } catch {}
        forceSetDropDownDisplay(ddl, shown);
      
        // زوّق اللائحة (li) باش يبانو فيها counts
        setTimeout(() => {
          try { ddl.trigger("dataBound"); } catch {}
        }, 0);
      
        log("Selected:", shown, "Id:", bestId, "Count:", c);
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






