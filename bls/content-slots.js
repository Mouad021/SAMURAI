// == CALENDRIA Debug SlotSelection Payload (NO SEND) ==
(() => {
  "use strict";

  const PATH_OK = location.pathname.toLowerCase().includes("/mar/appointment/slotselection");
  if (!PATH_OK) return;

  if (window.__calendria_debug_slotpayload_started) return;
  window.__calendria_debug_slotpayload_started = true;

  const log  = (...a) => console.log("%c[CALENDRIA][DebugSlots]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CALENDRIA][DebugSlots]", ...a);

  let __dateEl = null, __dateName = null;
  let __slotEl = null, __slotName = null;

  // =======================================================
  // UTILITIES
  // =======================================================
  function getAllScriptText() {
    return Array.from(document.scripts)
      .map(s => s.textContent || "")
      .filter(Boolean)
      .join("\n;\n");
  }

  function getToken() {
    return (
      document.querySelector('input[name="__RequestVerificationToken"]')?.value ||
      localStorage.getItem("__RequestVerificationToken") ||
      sessionStorage.getItem("__RequestVerificationToken") ||
      ""
    );
  }

  // =======================================================
  // ACTIVE INPUTS (Date + Slot hidden names)
  // =======================================================
  function getActiveDateInput() {
    const datePickers = Array.from(document.querySelectorAll('.k-datepicker, .k-widget.k-datepicker'));
    const w = datePickers.find(x => x && x.offsetParent !== null);
    if (w) {
      const inp = w.querySelector('input[data-role="datepicker"], input.k-input');
      if (inp && !inp.disabled) return inp;
    }
    const all = Array.from(document.querySelectorAll('input[data-role="datepicker"], input.k-input'));
    return all.find(el => el.offsetParent !== null && !el.disabled) || null;
  }

  function getActiveSlotHiddenInputRaw() {
    const wrappers = Array.from(document.querySelectorAll('.k-widget.k-dropdown, .k-dropdown'));
    const w = wrappers.find(x => x && x.offsetParent !== null);
    if (!w) return null;
    const original = w.parentElement.querySelector('input[data-role="dropdownlist"]');
    if (original) return original;
    const fallback = Array.from(document.querySelectorAll('input[data-role="dropdownlist"]'));
    return fallback.find(el => el.name) || null;
  }

  function captureStableNames() {
    if (!__dateEl) {
      __dateEl = getActiveDateInput();
      __dateName = __dateEl?.name || null;
    }
    if (!__slotEl) {
      __slotEl = getActiveSlotHiddenInputRaw();
      __slotName = __slotEl?.name || null;
    }
  }

  async function ensureStableNamesReady(maxTries = 20) {
    for (let i = 0; i < maxTries; i++) {
      captureStableNames();
      if (__dateName && __slotName) {
        log("Stable names:", { __dateName, __slotName });
        return true;
      }
      await new Promise(r => setTimeout(r, 120));
    }
    warn("Stable names still missing:", { __dateName, __slotName });
    return false;
  }

  // =======================================================
  // SNAPSHOT + FORMDATA BUILDER (منطقك الأصلي)
  // =======================================================
  function snapshotBasePayload(form) {
    const controls = Array.from(form.querySelectorAll("input[name], select[name], textarea[name]"));
    const base = {};
    controls.forEach(el => {
      if (!el.name) return;
      if (el.name === "ResponseData") return;
      base[el.name] = el.value ?? "";
    });
    return { base, controls };
  }

  function buildFormDataForSlot({ dateText, slotId, base, controls, form }) {
    const payloadObj = { ...base };

    // نحترم الأسماء الحقيقية للـ date ولـ slot
    if (__dateName) payloadObj[__dateName] = dateText;
    if (__slotName) payloadObj[__slotName] = String(slotId);

    // حقول أساسية من الصفحة
    payloadObj.AppointmentFor = form.querySelector('input[name="AppointmentFor"]')?.value || payloadObj.AppointmentFor || "";
    payloadObj.SearchDate     = form.querySelector('input[name="SearchDate"]')?.value     || payloadObj.SearchDate     || "";
    payloadObj.Loc            = form.querySelector('input[name="Loc"]')?.value            || payloadObj.Loc            || "";
    payloadObj.__RequestVerificationToken = getToken() || payloadObj.__RequestVerificationToken || "";

    // ResponseData: كل المفاتيح، غير date/slot فيهم القيمة والباقي فارغ
    const respObj = {};
    for (const key in payloadObj) {
      if (key === __dateName)      respObj[key] = dateText;
      else if (key === __slotName) respObj[key] = String(slotId);
      else                         respObj[key] = "";
    }
    const respStr = JSON.stringify(respObj);

    const respEl = form.querySelector('input[name="ResponseData"]');
    if (respEl) respEl.value = respStr;

    const fd = new FormData();
    const SPECIAL = new Set(["Data","ResponseData","AppointmentFor","SearchDate","Loc","__RequestVerificationToken"]);

    controls.forEach(el => {
      const name = el.name;
      if (!name || SPECIAL.has(name)) return;
      fd.append(name, payloadObj[name] ?? "");
    });

    if ("Data" in payloadObj) fd.append("Data", payloadObj.Data ?? "");
    fd.append("ResponseData", respStr);
    fd.append("AppointmentFor", payloadObj.AppointmentFor ?? "");
    fd.append("SearchDate",     payloadObj.SearchDate     ?? "");
    fd.append("Loc",            payloadObj.Loc            ?? "");
    fd.append("__RequestVerificationToken", payloadObj.__RequestVerificationToken ?? "");

    return fd;
  }

  // =======================================================
  // استخراج URL ديال SlotSelection (بدون إرسال)
  // =======================================================
  function detectSlotSelectionUrl() {
    const txt = getAllScriptText();
    const m = txt.match(/\/MAR\/[^"' \n]*\/SlotSelection\b/i);
    const url = m?.[0] || "/MAR/appointment/SlotSelection";
    log("Detected SlotSelection URL:", url);
    return url;
  }

  // =======================================================
  // دالة رئيسية: تكوّن الطلب فقط، بلا fetch نهائياً
  // =======================================================
  async function buildSlotSelectionRequestOnce() {
    const form = document.querySelector("form") || document.body;

    const ok = await ensureStableNamesReady();
    if (!ok) {
      warn("Cannot build request: missing date/slot names");
      return;
    }

    const dateText =
      __dateEl?.value ||
      form.querySelector('input[name="' + __dateName + '"]')?.value ||
      "";
    const slotId =
      __slotEl?.value ||
      form.querySelector('input[name="' + __slotName + '"]')?.value ||
      "";

    if (!dateText || !slotId) {
      warn("Missing dateText or slotId", { dateText, slotId });
      return;
    }

    const { base, controls } = snapshotBasePayload(form);
    const fd = buildFormDataForSlot({ dateText, slotId, base, controls, form });
    const url = detectSlotSelectionUrl();

    // نحوّل FormData لكائن سهل للمعاينة
    const bodyObj = {};
    for (const [k, v] of fd.entries()) {
      bodyObj[k] = v;
    }

    const debugPayload = {
      url,
      method: "POST",
      body: bodyObj
    };

    // نخزّنو فـ window باش تقدر تشوفو من console
    window.__CALENDRIA_DEBUG_SLOTREQUEST = debugPayload;

    log("Built SlotSelection request (NO SEND):", debugPayload);
  }

  // نخلي الدالة متاحة للاستعمال اليدوي من console
  window.buildSlotSelectionRequestOnce = buildSlotSelectionRequestOnce;

  // اختيارياً: نقدر نستدعيها أوتوماتيكياً مرة وحدة
  // buildSlotSelectionRequestOnce();

  log("Debug SlotSelection payload builder READY (no network send).");
})();
