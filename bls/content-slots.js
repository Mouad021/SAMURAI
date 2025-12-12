(() => {
  "use strict";

  const PATH_OK = /\/mar\/appointment\/slotselection/i.test(location.pathname);
  if (!PATH_OK) return;

  if (window.__cal_auto_pick_day_slot_FINAL_V3) return;
  window.__cal_auto_pick_day_slot_FINAL_V3 = true;

  const log  = (...a) => console.log("%c[CAL-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-AUTO]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isVisible = (el) => !!(el && el.offsetParent !== null);

  const SLOTS_URL_RE = /GetAvailableSlotsByDate/i;

  // ✅ إذا بغيتي 0 مايبانوش خليه true
  const REMOVE_ZERO_FROM_LIST = true;

  const STATE = {
    pickedDay: "",
    bestId: null,
    bestText: "",
    ddl: null,
    ddlInput: null,
    ds: null,
    handlersBound: false,
    interceptorInstalled: false,
    ajaxHookInstalled: false,
    patchApplied: false,
    lastRespSig: "",
    refreshScheduled: false
  };

  function scheduleOnce(fn) {
    if (STATE.refreshScheduled) return;
    STATE.refreshScheduled = true;
    requestAnimationFrame(() => {
      STATE.refreshScheduled = false;
      try { fn(); } catch {}
    });
  }

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

  async function waitFor(pred, maxMs = 20000, stepMs = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try { if (pred()) return true; } catch {}
      await sleep(stepMs);
    }
    return false;
  }

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

  function ensureDDL() {
    try {
      // إذا تبدّل instance/DOM: عاود لقاه
      if (!STATE.ddl || !STATE.ddl.wrapper || !STATE.ddl.wrapper[0] || !document.contains(STATE.ddl.wrapper[0])) {
        const o = findRealSlotDDL();
        if (o) {
          STATE.ddl = o.ddl;
          STATE.ddlInput = o.inp;
          bindKeepSelectionHandlers(STATE.ddl);
          patchSiteOnSlotOpen();
          log("DDL re-acquired:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
        }
      }
    } catch {}
    return STATE.ddl;
  }

  function setDateWithKendo(dp, inp, dateText) {
    const [Y, M, D] = String(dateText).split("-").map(n => parseInt(n, 10));
    const dateObj = new Date(Y, (M - 1), D);

    // ✅ مهم: ملي كتبدّل النهار، خليه يعاود يحقن من جديد
    STATE.lastRespSig = "";

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

  function normalizeSlots(json) {
    if (!json?.success || !Array.isArray(json.data)) return [];

    const all = json.data.map(x => {
      const c = Number(x?.Count) || 0;
      const baseName = String(x?.Name || "").replace(/\s*\(count\s*:\s*\d+\)\s*$/i, "").trim();
      return { ...x, Count: c, __rawName: baseName, __DisplayName: `${baseName} (count : ${c})` };
    });

    return REMOVE_ZERO_FROM_LIST ? all.filter(x => x.Count > 0) : all;
  }

  function pickBestSlot(items) {
    if (!Array.isArray(items) || !items.length) return null;
    let best = null;
    for (const s of items) {
      if (!best || (Number(s.Count) || 0) > (Number(best.Count) || 0)) best = s;
    }
    return best;
  }

  function forceSetDropDownDisplay(ddl, displayText) {
    try {
      const wrap = ddl.wrapper?.[0];
      const kInput = wrap ? wrap.querySelector("span.k-input") : null;
      if (kInput && displayText) kInput.textContent = displayText;
    } catch {}
  }

  function buildAndSetDS(ddl, itemsWithDisplay) {
    const dataForDS = itemsWithDisplay.map(x => ({
      ...x,
      Name: x.__DisplayName,
      __rawName: x.__rawName,
      __count: Number(x.Count) || 0
    }));

    if (!STATE.ds) {
      STATE.ds = new window.kendo.data.DataSource({ data: dataForDS });
      try { window.slotDataSource = STATE.ds; } catch {}
      ddl.setDataSource(STATE.ds);
    } else {
      STATE.ds.data(dataForDS);
    }

    scheduleOnce(() => {
      try { ddl.refresh(); } catch {}
    });
  }

  function selectBestAndLock(ddl, items) {
    const best = pickBestSlot(items);
    if (!best) return false;

    STATE.bestId = String(best.Id);
    STATE.bestText = best.__DisplayName;

    try {
      ddl.value(STATE.bestId);
      ddl.trigger("change");
      forceSetDropDownDisplay(ddl, STATE.bestText);
      log("Slot selected:", STATE.bestText, "Id:", STATE.bestId, "Count:", best.Count);
      return true;
    } catch (e) {
      warn("selectBestAndLock failed", e);
      return false;
    }
  }

  // ✅ ديما خضر و clickable (حيت 0 راه متحيدين)
  function fixListDomClickable(ddl) {
    try {
      if (!ddl || !ddl.ul || !ddl.ul[0]) return;
      const lis = ddl.ul[0].querySelectorAll("li.k-item");
      lis.forEach((li) => {
        li.classList.remove("k-state-disabled");
        li.setAttribute("aria-disabled", "false");
        li.style.pointerEvents = "auto";
        li.style.opacity = "1";

        const inner = li.querySelector(".slot-item") || li.firstElementChild;
        if (inner) {
          inner.style.pointerEvents = "auto";
          inner.style.cursor = "pointer";
          inner.classList.add("bg-success");
          inner.classList.remove("bg-danger");
        }
      });
    } catch {}
  }

  function scheduleFixList(ddl) {
    scheduleOnce(() => {
      try { fixListDomClickable(ddl); } catch {}
    });
  }

  function patchSiteOnSlotOpen() {
    if (STATE.patchApplied) return;
    STATE.patchApplied = true;

    if (typeof window.OnSlotOpen === "function") {
      const original = window.OnSlotOpen;

      window.OnSlotOpen = function patchedOnSlotOpen() {
        let ret;
        try { ret = original.apply(this, arguments); } catch (e) {}

        setTimeout(() => {
          try {
            const ddl = ensureDDL();
            if (!ddl) return;

            if (STATE.ds) {
              ddl.setDataSource(STATE.ds);
              ddl.refresh();
            }
            scheduleFixList(ddl);

            if (STATE.bestId) {
              ddl.value(STATE.bestId);
              forceSetDropDownDisplay(ddl, STATE.bestText);
            }
          } catch {}
        }, 0);

        return ret;
      };

      log("Patched OnSlotOpen.");
    }
  }

  function bindKeepSelectionHandlers(ddl) {
    if (STATE.handlersBound) return;
    STATE.handlersBound = true;

    ddl.bind("open", () => {
      setTimeout(() => {
        try {
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });

    ddl.bind("dataBound", () => {
      setTimeout(() => {
        try {
          if (STATE.bestId) {
            ddl.value(STATE.bestId);
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });

    ddl.bind("change", () => {
      setTimeout(() => {
        try {
          const di = ddl.dataItem();
          if (di && di.Id != null) {
            STATE.bestId = String(di.Id);
            STATE.bestText = String(di.Name || "");
            forceSetDropDownDisplay(ddl, STATE.bestText);
          }
          scheduleFixList(ddl);
        } catch {}
      }, 0);
    });
  }

  function injectSlotsAndSelectBest(ddl, itemsWithDisplay) {
    if (!ddl) return;
    if (!itemsWithDisplay || !itemsWithDisplay.length) {
      warn("No slots to show.");
      return;
    }

    buildAndSetDS(ddl, itemsWithDisplay);
    patchSiteOnSlotOpen();
    bindKeepSelectionHandlers(ddl);
    selectBestAndLock(ddl, itemsWithDisplay);
    scheduleFixList(ddl);
  }

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
      const ddl = ensureDDL();
      if (!ddl) return warn("Slot DDL not found");
  
      const sig = signatureOf(json);
      if (sig && sig === STATE.lastRespSig) return;
      STATE.lastRespSig = sig;
  
      const items = normalizeSlots(json);
      if (!items.length) return warn("Slots response empty after normalize.");
  
      injectSlotsAndSelectBest(ddl, items);
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

  // ✅ الجديد: hook ديال $.ajax باش ملي الموقع يكمّل success ديالو كنعاودو نطبّقو التعديلات
  function installAjaxHook() {
    if (STATE.ajaxHookInstalled) return;
    STATE.ajaxHookInstalled = true;

    const $ = window.jQuery;
    if (!$ || !$.ajax) return;

    const _ajax = $.ajax.bind($);
    $.ajax = function(settings) {
      const url = (typeof settings === "string") ? settings : (settings && settings.url) ? settings.url : "";
      const req = _ajax.apply(this, arguments);

      try {
        if (SLOTS_URL_RE.test(url) && req && typeof req.then === "function") {
          req.then((data) => {
            // ✅ بعد ما الموقع يكمل update ديالو
            setTimeout(() => {
              try { onSlotsResponse(data); } catch {}
            }, 0);
          }).catch(() => {});
        }
      } catch {}

      return req;
    };

    log("jQuery.ajax hooked for slots.");
  }

  (async () => {
    if (!await waitForJqKendo()) return warn("jQuery/Kendo not ready (timeout)");

    installXHRInterceptor();
    installAjaxHook();

    const days = getAvailDays();
    if (!days.length) return warn("No available days in availDates.ad");

    const picked = pickRandom(days);
    STATE.pickedDay = picked.DateText;
    log("Picked random day:", STATE.pickedDay);

    const hasDP = await waitFor(() => !!findRealDatePicker(), 20000, 120);
    if (!hasDP) return warn("Real DatePicker not found");
    const dpObj = findRealDatePicker();
    try {
      dpObj.dp.bind("change", () => {
        log("Date changed manually -> reset signature");
        STATE.lastRespSig = "";
      });
    } catch {}

    await waitFor(() => !!findRealSlotDDL(), 20000, 120);
    const o = findRealSlotDDL();
    if (o) {
      STATE.ddl = o.ddl;
      STATE.ddlInput = o.inp;
      patchSiteOnSlotOpen();
      bindKeepSelectionHandlers(STATE.ddl);
      log("Slot DDL prepared:", STATE.ddlInput?.id || STATE.ddlInput?.name || "(unknown)");
    }

    if (!setDateWithKendo(dpObj.dp, dpObj.inp, STATE.pickedDay)) return;
  })().catch(e => warn("Fatal", e));
})();

