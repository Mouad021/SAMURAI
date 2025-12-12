(() => {
  "use strict";

  const PATH_OK = location.pathname.toLowerCase().includes("/mar/appointment/slotselection");
  if (!PATH_OK) return;

  if (window.__calendria_dynslots_started) return;
  window.__calendria_dynslots_started = true;

  // ==========================
  // DELAY من POPUP (DynSlots) + master من Delays
  // ==========================
  let AUTO_DELAY_MS = 0;
  let AUTO_ENABLED  = false;
  let AUTO_REPEAT_COUNT = 1;
  const REPEAT_GAP_MS = 1000;

  // فلاغ: واش الرابح ديال GETAvailableSlots جاهز؟
  let __raceWinnerReady = false;

  function loadDelaySnapshot() {
    try {
      const snap = window.__SAMURAI_STORAGE || {};

      const enabled = (snap.calendria_use_delays || "off") === "on";
      const rawDelay = snap.calendria_delay_slotselection;

      // SlotSelection delay
      if (enabled && rawDelay !== undefined && rawDelay !== null && String(rawDelay).trim() !== "") {
        const n = parseFloat(String(rawDelay).replace(",", "."));
        if (!isNaN(n) && n >= 0) {
          AUTO_DELAY_MS = n * 1000; // seconds → ms
          AUTO_ENABLED  = true;
        }
      }

      // عدد الطلبات التلقائية من الاضافة
      // المفتاح في الستوريج: calendria_delay_slotselection_requests
      const rawRepeat = snap.calendria_delay_slotselection_requests;
      if (rawRepeat !== undefined && rawRepeat !== null && String(rawRepeat).trim() !== "") {
        const r = parseInt(String(rawRepeat), 10);
        if (!isNaN(r) && r > 0) {
          // نحصرها بين 1 و 10 فقط
          AUTO_REPEAT_COUNT = Math.min(Math.max(r, 1), 10);
        }
      }

      console.log(
        "[CALENDRIA][DynSlots] SlotSelection delay (ms):",
        AUTO_DELAY_MS,
        "enabled:",
        AUTO_ENABLED,
        "repeatCount:",
        AUTO_REPEAT_COUNT
      );
    } catch (e) {
      console.warn("[CALENDRIA][DynSlots] cannot read SlotSelection delay from storage", e);
    }
  }

  loadDelaySnapshot();

  const MODE_KEY = "calendria_samurai_mode";

  const log  = (...a) => console.log("%c[CALENDRIA][DynSlots]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CALENDRIA][DynSlots]", ...a);

  let __lastRandomDayText = "";
  let __lastOpenSlots = [];
  let __selectedSlotId = null;

  let __dateEl = null, __dateName = null;
  let __slotEl = null, __slotName = null;

  let __countdownBtn = null;
  let __tpl = null;
  let __slotsAbort = null;

  // Samurai mode: false = SINGLE HOUR, true = ALL HOURS
  let SAMURAI_ALL_MODE = false;

  // ==========================
  // LAST SELECTION STORAGE (date + hour)
  // ==========================
  const LAST_SELECTION_KEY = "calendria_last_slot_selection";

  function saveLastSelection(dateText, slot) {
    if (!dateText || !slot) return;
    const slotLabel = slot && slot.Name
      ? `${slot.Name} (count : ${slot.Count ?? 0})`
      : "";
    const payload = { date: dateText, slot: slotLabel };
    try {
      localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(payload));
      console.log("[CALENDRIA][DynSlots] Saved selection:", payload);
    } catch (e) {
      console.warn("[CALENDRIA][DynSlots] Cannot save selection", e);
    }
  }

  // ==========================
  // TOASTS
  // ==========================
  let __toastContainer = null;
  let __toastSlotsWait = null;
  let __toastRequestPending = null;

  function ensureToastContainer() {
    if (__toastContainer && document.body.contains(__toastContainer)) return __toastContainer;
    const c = document.createElement("div");
    c.id = "__cal_toast_container";
    c.className = "cal-toast-container";
    document.body.appendChild(c);
    __toastContainer = c;
    return c;
  }

  function hideToast(el) {
    if (!el) return;
    try {
      el.classList.add("cal-toast-hide");
      setTimeout(() => { el.remove(); }, 180);
    } catch {
      try { el.remove(); } catch {}
    }
  }

  function clearAllToasts() {
    if (!__toastContainer) return;
    __toastContainer.innerHTML = "";
    __toastSlotsWait = null;
    __toastRequestPending = null;
  }

  function showToast(message, type = "info", options = {}) {
    const { durationMs = 3500, persistent = false } = options;
    const container = ensureToastContainer();

    const el = document.createElement("div");
    el.className = "cal-toast";
    if (type === "pending")       el.classList.add("cal-toast-pending");
    else if (type === "success")  el.classList.add("cal-toast-success");
    else if (type === "reserved") el.classList.add("cal-toast-reserved");
    else if (type === "limit")    el.classList.add("cal-toast-limit");
    else                          el.classList.add("cal-toast-info");

    el.textContent = message;
    container.appendChild(el);

    if (!persistent) {
      setTimeout(() => hideToast(el), durationMs);
    }
    return el;
  }

  // ==========================
  // Load CSS from CDN (no CSP error)
  // ==========================
  function injectCssFileOnce() {
    if (document.getElementById("__cal_css_link")) return;
    try {
      const link = document.createElement("link");
      link.id = "__cal_css_link";
      link.rel = "stylesheet";
      // غيّر هذا الرابط إذا حطيت calendria.css فمسار آخر
      link.href = "https://samurai-88i.pages.dev/bls/calendria.css";
      document.head.appendChild(link);
    } catch (e) {
      console.warn("[CALENDRIA][DynSlots] CSS inject skipped:", e);
    }
  }

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

  function parseOpenSlots(resp) {
    if (!resp?.success || !Array.isArray(resp.data)) return [];
    return resp.data
      .filter(s => Number(s.Count) > 0)
      .map(s => ({ ...s, Count: Number(s.Count) || 0 }));
  }

  function extractAppointmentDateFromUrl(u) {
    try {
      const url = new URL(u, location.origin);
      return url.searchParams.get("appointmentDate") || "";
    } catch {
      const m = String(u).match(/appointmentDate=([^&]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    }
  }

  // =======================================================
  // ACTIVE INPUTS
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
      if (__dateName) log("Stable dateName:", __dateName);
    }
    if (!__slotEl) {
      __slotEl = getActiveSlotHiddenInputRaw();
      __slotName = __slotEl?.name || null;
      if (__slotName) log("Stable slotName:", __slotName);
    }
  }

  async function ensureStableNamesReady(maxTries = 20) {
    for (let i = 0; i < maxTries; i++) {
      captureStableNames();
      if (__dateName && __slotName) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    warn("Stable names still missing:", { __dateName, __slotName });
    return false;
  }

  // =======================================================
  // availDates + template
  // =======================================================
  function extractAvailDates() {
    try {
      const g = unsafeWindow?.availDates || window.availDates;
      if (g?.ad && Array.isArray(g.ad)) return g;
    } catch {}
    const txt = getAllScriptText();
    const m = txt.match(/var\s+availDates\s*=\s*({[\s\S]*?});/);
    if (!m) return null;
    try { return JSON.parse(m[1]); }
    catch { return new Function("return " + m[1])(); }
  }

  function extractGetSlotsTemplate() {
    const txt = getAllScriptText();
    const re = /url\s*:\s*["']([^"']*GetAvailableSlotsByDate\?[^"']*appointmentDate=)\s*["']\s*\+\s*appointmentDate\s*\+\s*["']([^"']*)/i;
    const m = txt.match(re);
    if (m) {
      let prefix = m[1];
      let suffix = m[2] || "";
      if (!prefix.startsWith("/")) prefix = "/MAR/appointment/" + prefix;
      return { prefix, suffix };
    }
    const m2 =
      txt.match(/\/MAR\/appointment\/GetAvailableSlotsByDate\?[^"' \n]+/i) ||
      txt.match(/GetAvailableSlotsByDate\?[^"' \n]+/i);
    if (!m2) return null;

    let raw = m2[0];
    if (!raw.startsWith("/")) raw = "/MAR/appointment/" + raw;

    const idx = raw.toLowerCase().indexOf("appointmentdate=");
       if (idx !== -1) {
      const after = raw.slice(idx + "appointmentdate=".length);
      return { prefix: raw.slice(0, idx + "appointmentdate=".length), suffix: after };
    }
    return { prefix: raw + "&appointmentDate=", suffix: "" };
  }

  function getAvailableDays(avail) {
    const ad = avail?.ad || [];
    return ad.filter(d =>
      d &&
      (d.SingleSlotAvailable === true || d.SingleSlotAvailable === "true") &&
      (d.AppointmentDateType === 0   || d.AppointmentDateType === "0")
    );
  }

  function buildDaysGrid(availDays, trigger, popup) {
    const grid = popup.querySelector(".cal-days-grid");
    grid.innerHTML = "";

    if (!Array.isArray(availDays) || !availDays.length) {
      const msg = document.createElement("div");
      msg.className = "cal-no-slots-msg";
      msg.textContent = "No available days";
      grid.appendChild(msg);
      return;
    }

    availDays.forEach(d => {
      if (!d || !d.DateText) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day-btn cal-day-avail";
      btn.dataset.dateText = d.DateText;
      btn.textContent = d.DateText;

      btn.addEventListener("click", () => selectDay(d.DateText, btn, trigger, popup));
      grid.appendChild(btn);
    });
  }

  function pickRandomDay(days) {
    if (!days.length) return null;
    return days[Math.floor(Math.random() * days.length)];
  }

  async function fetchSlotsForDate(tpl, dateText, signal, isRace = false) {
    const headers = {
      "accept": "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "RequestVerificationToken": getToken()
    };
    if (isRace) {
      headers["X-CAL-RACE"] = "1";
    }

    const res = await fetch(tpl.prefix + encodeURIComponent(dateText) + tpl.suffix, {
      method: "POST",
      credentials: "include",
      headers,
      signal
    });
    return res.json();
  }

  // =======================================================
  // CUSTOM DAYS PICKER
  // =======================================================
  function hideOriginalDateWidget() {
    const widget = __dateEl?.closest(".k-datepicker, .k-widget.k-datepicker");
    if (widget) widget.classList.add("cal-hidden-date-widget");
  }

  function ensureDaysPicker(availDays) {
    const form = document.querySelector("form") || document.body;
    let card = document.getElementById("__cal_days_card");
    if (card) return card;

    card = document.createElement("div");
    card.id = "__cal_days_card";
    card.className = "cal-card";

    const bar = document.createElement("div");
    bar.className = "cal-date-bar";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "cal-date-trigger";
    trigger.id = "__cal_date_trigger";
    trigger.textContent = "Select available day";

    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "cal-date-icon";
    icon.innerHTML = "📅";

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "cal-date-refresh";
    refreshBtn.textContent = "Refresh";
    refreshBtn.title = "Refresh available days (no page reload)";

    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const avail = extractAvailDates();
        const days = getAvailableDays(avail) || [];
        const popup = document.getElementById("__cal_days_popup");
        const tr = document.getElementById("__cal_date_trigger") || trigger;
        buildDaysGrid(days, tr, popup);
      } catch (err) {
        warn("Refresh days failed", err);
      }
    });

    bar.appendChild(trigger);
    bar.appendChild(icon);
    bar.appendChild(refreshBtn);

    const popup = document.createElement("div");
    popup.id = "__cal_days_popup";
    popup.className = "cal-days-popup";

    const grid = document.createElement("div");
    grid.className = "cal-days-grid";
    popup.appendChild(grid);

    card.appendChild(bar);
    card.appendChild(popup);

    const insertPoint = __dateEl?.closest(".mb-3") || form;
    insertPoint.appendChild(card);

    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.classList.toggle("open");
    });

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    document.addEventListener("click", () => popup.classList.remove("open"));
    popup.addEventListener("click", (e) => e.stopPropagation());

    buildDaysGrid(availDays, trigger, popup);
    return card;
  }

  async function selectDay(dateText, btn, trigger, popup) {
    popup.querySelectorAll(".cal-day-btn").forEach(x => x.classList.remove("cal-day-selected"));
    btn.classList.add("cal-day-selected");
    trigger.textContent = dateText;
    popup.classList.remove("open");
  
    __lastRandomDayText = dateText;
    if (__dateEl) __dateEl.value = dateText;
  
    try { __slotsAbort?.abort(); } catch {}
    __slotsAbort = new AbortController();
  
    try {
      const j = await fetchSlotsForDate(__tpl, dateText, __slotsAbort.signal, false);
  
      const openSlots = parseOpenSlots(j);
      if (!openSlots.length) {
        __raceWinnerReady = false;
        showToast("no open slots", "limit");
        // باش الواجهة تبان فيها "No open slots for this day"
        onAnyGetAvailableSlots(__tpl.prefix + encodeURIComponent(dateText) + __tpl.suffix, j);
        return;
      }
  
      onAnyGetAvailableSlots(__tpl.prefix + encodeURIComponent(dateText) + __tpl.suffix, j);
      __raceWinnerReady = true;
    } catch (e) {}
  }


  // =======================================================
  // HOURS BOX UI
  // =======================================================
  function findHoursWidget() {
    const widgets = Array.from(document.querySelectorAll(".k-widget.k-dropdown"));
    return widgets.find(w => w.offsetParent !== null) || widgets[0] || null;
  }

  function ensureBoxesContainer() {
    let cont = document.getElementById("__cal_slots_boxes");
    if (cont) return cont;

    cont = document.createElement("div");
    cont.id = "__cal_slots_boxes";
    cont.className = "cal-slots-container";

    const widget = findHoursWidget();
    if (widget && widget.parentElement) {
      widget.insertAdjacentElement("afterend", cont);
    } else {
      (document.querySelector("form") || document.body).appendChild(cont);
    }
    return cont;
  }

  function hideOriginalHoursDropdown() {
    const widget = findHoursWidget();
    if (widget) widget.classList.add("cal-hidden-slot-dropdown");
  }

  function renderSlotBoxes(openSlots) {
    const cont = ensureBoxesContainer();
    cont.innerHTML = "";
    __selectedSlotId = null;

    if (!openSlots.length) {
      const msg = document.createElement("div");
      msg.className = "cal-no-slots-msg";
      msg.textContent = "No open slots for this day";
      cont.appendChild(msg);
      hideOriginalHoursDropdown();
      return;
    }

    __lastOpenSlots = openSlots;

    openSlots.forEach((slot, idx) => {
      const count = Number(slot.Count) || 0;
      const isGreen = count > 1;

      const b = document.createElement("button");
      b.type = "button";
      b.className = "cal-slot-btn " + (isGreen ? "cal-slot-green" : "cal-slot-red");
      b.dataset.slotId = slot.Id;

      const main = document.createElement("div");
      main.className = "cal-slot-label";
      main.textContent = slot.Name;

      const sub = document.createElement("small");
      sub.className = "cal-slot-count";
      sub.textContent = "Count: " + count;

      b.appendChild(main);
      b.appendChild(sub);

      b.onclick = () => {
        cont.querySelectorAll(".cal-slot-btn").forEach(x => x.classList.remove("cal-slot-selected"));
        b.classList.add("cal-slot-selected");
        __selectedSlotId = slot.Id;

        if (__slotEl) {
          __slotEl.value = String(slot.Id);
          __slotEl.dispatchEvent(new Event("input", { bubbles: true }));
          __slotEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };

      cont.appendChild(b);
      if (idx === 0) b.click();
    });

    hideOriginalHoursDropdown();
  }
  // =======================================================
  // KENDO DROPDOWN INJECTION (replace custom boxes)
  // =======================================================
  function getKendoJQ() {
    return (window.kendo && window.kendo.jQuery) ? window.kendo.jQuery : null;
  }
  
  function getKendoSlotWidget() {
    const jq = getKendoJQ();
    if (!jq) return null;
  
    if (!__slotEl) __slotEl = getActiveSlotHiddenInputRaw();
    if (!__slotEl) return null;
  
    try {
      const $el = jq(__slotEl);
      return (
        $el.data("kendoDropDownList") ||
        $el.data("kendoComboBox") ||
        $el.data("kendoMultiColumnComboBox") ||
        null
      );
    } catch {
      return null;
    }
  }

  
  function injectSlotsIntoKendoDropdown(openSlots) {
    const w = getKendoSlotWidget();
    if (!w) {
      warn("Kendo widget not found yet");
      return false;
    }
  
    const data = (openSlots || []).map((s, i) => ({
      Id: String(s.Id),
      Name: String(s.Name || ""),
      Count: Number(s.Count) || 0,
      __idx: i
    }));
  
    try {
      // template ديال العناصر (بحال الصور ديالك)
      const itemTpl = (d) => {
        const cls = (Number(d.Count) > 0) ? "bg-success" : "bg-danger";
        const label = String(d.Name || "");
        return `<div class="slot-item ${cls}" style="border-radius:8px;padding:4px 18px;cursor:pointer;color:white;">${label}</div>`;
      };
  
      // value template باش اللي مختار يبقى كيبان مزيان
      const valueTpl = (d) => (d && d.Name) ? String(d.Name) : "--Select--";
  
      // DropDownList/ComboBox كيدعمو هاد options
      if (typeof w.setOptions === "function") {
        w.setOptions({
          dataTextField: "Name",
          dataValueField: "Id",
          template: itemTpl,
          valueTemplate: valueTpl
        });
      }
  
      // دخّل الداتا بطريقة مضمونة
      if (w.dataSource && typeof w.dataSource.data === "function") {
        w.dataSource.data(data);
      } else if (typeof w.setDataSource === "function" && window.kendo?.data?.DataSource) {
        w.setDataSource(new window.kendo.data.DataSource({ data }));
      }
  
      // refresh الصحيح (حيت refresh() ماشي دايماً موجود)
      if (w.listView && typeof w.listView.refresh === "function") w.listView.refresh();
      if (typeof w._refresh === "function") w._refresh();
      if (typeof w.refresh === "function") w.refresh();
  
      // فعّل widget إلا كان disabled
      if (typeof w.enable === "function") w.enable(true);
  
      // auto select أول واحد
      if (data.length) {
        if (typeof w.value === "function") w.value(data[0].Id);
        if (typeof w.text === "function") w.text(data[0].Name);
        if (typeof w.trigger === "function") w.trigger("change");
        __selectedSlotId = data[0].Id;
      } else {
        __selectedSlotId = null;
        if (typeof w.value === "function") w.value("");
        if (typeof w.text === "function") w.text("--Select--");
      }
  
      // hook change مرة وحدة
      if (!w.__cal_hooked && typeof w.bind === "function") {
        w.__cal_hooked = true;
  
        w.bind("change", () => {
          const v = (typeof w.value === "function") ? w.value() : "";
          __selectedSlotId = v ? String(v) : null;
  
          if (__slotEl) {
            __slotEl.value = __selectedSlotId || "";
            __slotEl.dispatchEvent(new Event("input", { bubbles: true }));
            __slotEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
  
        // مهم: فاش كتفتح القائمة، نجبرو list يعاود يرسم (باش ماتبانش خاوية)
        w.bind("open", () => {
          try {
            if (w.listView && typeof w.listView.refresh === "function") w.listView.refresh();
            if (typeof w._refresh === "function") w._refresh();
          } catch {}
        });
      }
  
      return true;
    } catch (e) {
      warn("injectSlotsIntoKendoDropdown failed", e);
      return false;
    }
  }

  function injectSlotsIntoOpenedKendoList(openSlots) {
    if (!openSlots || !openSlots.length) return false;
  
    // كنجبد آخر popup مفتوح (ديال Appointment Slot)
    const popups = Array.from(document.querySelectorAll(".k-animation-container .k-list-container.k-popup"));
    const popup = popups.find(p => p.querySelector(".k-list-scroller ul.k-list[id$='_listbox']"));
    if (!popup) return false;
  
    const ul = popup.querySelector(".k-list-scroller ul.k-list[id$='_listbox']");
    if (!ul) return false;
  
    // hide "No data found"
    const nodata = popup.querySelector(".k-nodata");
    if (nodata) nodata.style.display = "none";
  
    ul.innerHTML = "";
  
    openSlots.forEach((slot, idx) => {
      const li = document.createElement("li");
      li.className = "k-item";
      li.setAttribute("role", "option");
      li.setAttribute("tabindex", "-1");
      li.dataset.offsetIndex = String(idx);
      li.setAttribute("aria-selected", "false");
  
      const div = document.createElement("div");
      div.className = "slot-item bg-danger";
      div.style.cssText = "border-radius:8px;padding:4px 18px;cursor:pointer;color:white;";
      div.textContent = slot.Name;
  
      li.appendChild(div);
  
      li.addEventListener("click", () => {
        ul.querySelectorAll(".k-item").forEach(x => {
          x.classList.remove("k-state-selected", "k-state-focused");
          x.setAttribute("aria-selected", "false");
        });
  
        li.classList.add("k-state-selected", "k-state-focused");
        li.setAttribute("aria-selected", "true");
  
        __selectedSlotId = String(slot.Id);
  
        if (__slotEl) {
          __slotEl.value = __selectedSlotId;
          __slotEl.dispatchEvent(new Event("input", { bubbles: true }));
          __slotEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
  
        // إذا كاين widget خليه يتزامن
        const w = getKendoSlotWidget();
        try { if (w && typeof w.value === "function") w.value(__selectedSlotId); } catch {}
      });
  
      ul.appendChild(li);
    });
  
    return true;
  }
  
  function hookKendoOpenForSlotsOnce() {
    const w = getKendoSlotWidget();
    if (!w || w.__cal_open_hooked) return;
    w.__cal_open_hooked = true;
  
    if (typeof w.bind === "function") {
      w.bind("open", () => {
        setTimeout(() => {
          injectSlotsIntoOpenedKendoList(__lastOpenSlots);
        }, 0);
      });
    }
  }

  function onAnyGetAvailableSlots(url, json) {
    if (__toastSlotsWait) {
      hideToast(__toastSlotsWait);
      __toastSlotsWait = null;
    }
  
    const dateText =
      extractAppointmentDateFromUrl(url) ||
      (__dateEl?.value || __lastRandomDayText);
  
    const openSlots = parseOpenSlots(json);
  
    __lastOpenSlots = openSlots;
    __lastRandomDayText = dateText;
  
    // ✅ هنا التغيير المهم
    injectSlotsIntoKendoDropdown(openSlots);
    hookKendoOpenForSlotsOnce();
    try {
      chrome.runtime.sendMessage(
        {
          type: "CALENDRIA_SLOTS_RESULT",
          results: [{ date: dateText || "", slots: openSlots || [] }]
        },
        () => {}
      );
    } catch {}
  }


  // =======================================================
  // INTERCEPTORS
  // =======================================================
  function installInterceptors() {
    const _fetch = window.fetch.bind(window);

    window.fetch = async function (input, init = {}) {
      let url = "";
      if (typeof input === "string") url = input;
      else if (input && input.url) url = input.url;

      const isGetSlots = /GetAvailableSlotsByDate/i.test(url || "");

      // نتحقق واش الطلب ديال السباق (X-CAL-RACE)
      let isRace = false;
      try {
        const h = init && init.headers;
        if (h) {
          if (h instanceof Headers) {
            isRace = !!h.get("X-CAL-RACE");
          } else if (typeof h === "object") {
            isRace = !!(h["X-CAL-RACE"] || h["x-cal-race"]);
          }
        }
      } catch {}

      if (isGetSlots && !isRace) {
        __toastSlotsWait = showToast("waiting for slot…", "info", { persistent: true });
      }

      const res = await _fetch(input, init);

      if (res.status === 429 || res.status === 430) {
        showToast("too many request", "limit");
      }

      try {
        if (isGetSlots && !isRace) {
          const clone = res.clone();
          const ct = (clone.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            clone.json().then(j => onAnyGetAvailableSlots(url, j)).catch(() => {});
          }
        }
      } catch {}

      return res;
    };

    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__cal_url = url;
      return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      let toastForThis = null;
      try {
        if (/GetAvailableSlotsByDate/i.test(this.__cal_url || "")) {
          toastForThis = showToast("waiting for slot…", "info", { persistent: true });
          this.addEventListener("loadend", function () {
            hideToast(toastForThis);
          });
        }

        this.addEventListener("load", function () {
          try {
            const url = this.__cal_url || "";
            if (/GetAvailableSlotsByDate/i.test(url)) {
              const txt = this.responseText || "";
              const j = JSON.parse(txt);
              onAnyGetAvailableSlots(url, j);
            }
          } catch (e) {}
        });
      } catch {}
      return _send.apply(this, arguments);
    };
  }

  // =======================================================
  // FORMDATA
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

    if (__dateName) payloadObj[__dateName] = dateText;
    if (__slotName) payloadObj[__slotName] = String(slotId);

    payloadObj.AppointmentFor =
      form.querySelector('input[name="AppointmentFor"]')?.value ||
      payloadObj.AppointmentFor ||
      "";
    payloadObj.SearchDate =
      form.querySelector('input[name="SearchDate"]')?.value ||
      payloadObj.SearchDate ||
      "";
    payloadObj.Loc =
      form.querySelector('input[name="Loc"]')?.value ||
      payloadObj.Loc ||
      "";
    payloadObj.__RequestVerificationToken =
      getToken() || payloadObj.__RequestVerificationToken || "";

    // ===== ResponseData: فقط المفاتيح المشفرة =====
    const respObj = {};
    const SKIP_IN_RESP = new Set([
      "Data",
      "ResponseData",
      "AppointmentFor",
      "SearchDate",
      "Loc",
      "__RequestVerificationToken",
    ]);

    for (const key in payloadObj) {
      if (SKIP_IN_RESP.has(key)) continue;

      if (key === __dateName)      respObj[key] = dateText;
      else if (key === __slotName) respObj[key] = String(slotId);
      else                         respObj[key] = "";
    }

    const respStr = JSON.stringify(respObj);

    const respEl = form.querySelector('input[name="ResponseData"]');
    if (respEl) respEl.value = respStr;

    const fd = new FormData();
    const SPECIAL = new Set([
      "Data",
      "ResponseData",
      "AppointmentFor",
      "SearchDate",
      "Loc",
      "__RequestVerificationToken",
    ]);

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
    fd.append(
      "__RequestVerificationToken",
      payloadObj.__RequestVerificationToken ?? ""
    );

    return fd;
  }

  const MAX_RETRIES_502 = 5;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // =======================================================
  // POST SlotSelection
  // =======================================================
  async function postSlotSelection(fd, attempt = 1) {
    const txt = getAllScriptText();
    const m = txt.match(/\/MAR\/[^"' \n]*\/SlotSelection\b/i);
    const url = m?.[0] || "/MAR/appointment/SlotSelection";

    if (!__toastRequestPending) {
      __toastRequestPending = showToast("request pending…", "pending", { persistent: true });
    }

    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      redirect: "manual",
      headers: {
        "accept": "application/json, text/plain, */*",
        "x-requested-with": "XMLHttpRequest"
      },
      body: fd
    });

    if (res.status === 502 && attempt <= MAX_RETRIES_502) {
      await sleep(200 * attempt);
      return postSlotSelection(fd, attempt + 1);
    }

    if (__toastRequestPending) {
      hideToast(__toastRequestPending);
      __toastRequestPending = null;
    }

    showToast("request sent successfully", "success");
    return res;
  }

  // =======================================================
  // ApplicantSelection CHECK
  // =======================================================
  async function autoApplicantSelectionCheck() {
    const form = document.querySelector("form") || document.body;
    const dataVal = form.querySelector('input[name="Data"]')?.value || "";
    const locVal  = form.querySelector('input[name="Loc"]')?.value  || "";
    if (!dataVal || !locVal) return false;

    const url = `/MAR/Appointment/ApplicantSelection?data=${encodeURIComponent(dataVal)}&loc=${encodeURIComponent(locVal)}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        redirect: "manual"
      });
      if (res.status === 200) {
        clearAllToasts();
        showToast("rendez-vous reserved", "reserved", { persistent: true });
        window.location.href = url;
        return true;
      }
    } catch {}
    return false;
  }

  // =======================================================
  // SUBMITS
  // =======================================================
  async function submitOneHour() {
    // حماية: ما كنسمحش بأي POST SlotSelection حتى يكمل الرابح ديال GET
    if (!__raceWinnerReady) {
      showToast("wait slots race to finish", "limit");
      return;
    }

    const form = document.querySelector("form") || document.body;
    const dateText = __dateEl?.value || __lastRandomDayText;
    const slotId   = __selectedSlotId;

    await ensureStableNamesReady();

    if (!dateText || !slotId) {
      alert("اختار ساعة من البوكسات أولا");
      return;
    }

    const slot =
      __lastOpenSlots.find(s => String(s.Id) === String(slotId)) ||
      { Id: slotId, Name: "", Count: null };
    saveLastSelection(dateText, slot);

    const { base, controls } = snapshotBasePayload(form);
    const fd = buildFormDataForSlot({ dateText, slotId, base, controls, form });

    await postSlotSelection(fd);
    await autoApplicantSelectionCheck();
  }

  async function postAllOpenSlotsAuto() {
    if (!__raceWinnerReady) {
      showToast("wait slots race to finish", "limit");
      return;
    }

    const form = document.querySelector("form") || document.body;
    const dateText = __dateEl?.value || __lastRandomDayText;
    if (!dateText || !__lastOpenSlots.length) return;

    await ensureStableNamesReady();

    for (let i = 0; i < __lastOpenSlots.length; i++) {
      const slot = __lastOpenSlots[i];
      const slotId = slot.Id;

      saveLastSelection(dateText, slot);

      const { base, controls } = snapshotBasePayload(form);
      const fd = buildFormDataForSlot({ dateText, slotId, base, controls, form });

      await postSlotSelection(fd);
      const redirected = await autoApplicantSelectionCheck();
      if (redirected) return;
    }
  }

  async function samuraiSubmitAll() {
    await postAllOpenSlotsAuto();
  }

  // =======================================================
  // COUNTDOWN (ميلي ثانية + جزء من الثانية)
  // =======================================================
  function startInlineCountdownAlways(ms, onDone) {
    if (!__countdownBtn) {
      onDone();
      return;
    }

    if (ms <= 0) {
      __countdownBtn.textContent = "0.000s";
      __countdownBtn.disabled = true;
      __countdownBtn.remove();
      onDone();
      return;
    }

    const start = performance.now();
    const end = start + ms;

    __countdownBtn.disabled = true;

    function tick(now) {
      const left = end - now;
      if (left <= 0) {
        __countdownBtn.textContent = "0.000s";
        __countdownBtn.remove();
        onDone();
        return;
      }
      __countdownBtn.textContent = (left / 1000).toFixed(3) + "s";
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  // =======================================================
  // TARGET TIMER (كل دقيقة في ثانية + ميلي ثانية محددة)
  // =======================================================
  let __targetTimerRunning  = false;
  let __targetNextFireTs    = null;
  let __targetFiringNow     = false;

  function stopTargetTimer() {
    __targetTimerRunning = false;
    __targetNextFireTs   = null;
    const disp = document.getElementById("__cal_timer_display");
    if (disp) disp.textContent = "STOP";
    showToast("target timer stopped", "info");
  }

  function scheduleTargetTimer(sec, ms) {
    const now = new Date();
    const next = new Date(now.getTime());
    // نثبت نفس الدقيقة، نغيّر فقط الثانية و الميلي
    next.setSeconds(sec, ms);
    if (next <= now) {
      // إذا فات الوقت، نخليه للدقيقة الجاية
      next.setMinutes(next.getMinutes() + 1);
    }
    __targetNextFireTs   = next.getTime();
    __targetTimerRunning = true;
    showToast(
      `target timer started: every minute at ${sec}s + ${ms}ms`,
      "info"
    );
    targetTimerTick();
  }

  async function fireTargetOnce() {
    // نفس المنطق: POST SlotSelection + autoApplicantSelectionCheck
    try {
      __targetFiringNow = true;
      await submitOneHour();
      await autoApplicantSelectionCheck();
    } catch (e) {
      warn("Target timer fire error", e);
    } finally {
      __targetFiringNow = false;
    }
  }

  function targetTimerTick() {
    if (!__targetTimerRunning || __targetNextFireTs == null) return;

    const disp = document.getElementById("__cal_timer_display");
    const nowMs = Date.now();
    let left = __targetNextFireTs - nowMs;

    if (disp) {
      if (left > 0) {
        disp.textContent = (left / 1000).toFixed(3) + "s";
      } else {
        disp.textContent = "0.000s";
      }
    }

    if (left <= 0 && !__targetFiringNow) {
      // نضرب POST SlotSelection ديالنا + check
      fireTargetOnce();
      // المرة القادمة بعد 60 ثانية بالضبط
      __targetNextFireTs += 60 * 1000;
      left = __targetNextFireTs - Date.now();
    }

    if (__targetTimerRunning) {
      requestAnimationFrame(targetTimerTick);
    }
  }

  // =======================================================
  // BUTTONS
  // =======================================================
  function removeOriginalSubmit() {
    document.getElementById("btnSubmit")?.remove();
  }

  function injectButtons() {
    const form = document.querySelector("form");
    if (!form) return false;
    if (document.getElementById("__cal_actions_bar")) return true;

    const bar = document.createElement("div");
    bar.id = "__cal_actions_bar";
    bar.className = "cal-actions-bar";

    const b1 = document.createElement("button");
    b1.type = "button";
    b1.className = "cal-submit-one";
    b1.textContent = "SUBMIT";
    b1.onclick = submitOneHour;

    const b2 = document.createElement("button");
    b2.type = "button";
    b2.className = "cal-submit-samurai";
    b2.textContent = "SAMURAI SUBMIT";
    b2.onclick = async () => {
      if (SAMURAI_ALL_MODE) await samuraiSubmitAll();
      else await submitOneHour();
    };

    const bc = document.createElement("button");
    bc.type = "button";
    bc.className = "cal-countdown";

    if (AUTO_ENABLED) {
      bc.textContent = (AUTO_DELAY_MS / 1000).toFixed(3) + "s";
      bc.disabled = false;
      bc.title = "Countdown before auto submit (from DynSlots delay)";
    } else {
      bc.textContent = "AUTO OFF";
      bc.disabled = true;
      bc.title = "Auto submit disabled (Delays master OFF أو value فارغة)";
    }

    __countdownBtn = bc;

    bar.appendChild(b1);
    bar.appendChild(b2);
    bar.appendChild(bc);

    // ====== TARGET TIMER UI (second + ms) ======
    const timerBox = document.createElement("div");
    timerBox.className = "cal-timer-box";

    timerBox.innerHTML = `
      <div class="cal-timer-row">
        <label for="__cal_tgt_sec">sec</label>
        <input id="__cal_tgt_sec" type="number" min="0" max="59" value="0" />
        <label for="__cal_tgt_ms">ms</label>
        <input id="__cal_tgt_ms" type="number" min="0" max="999" value="0" />
        <button type="button" id="__cal_timer_start">START</button>
        <button type="button" id="__cal_timer_stop">STOP</button>
      </div>
      <div class="cal-timer-countdown" id="__cal_timer_display">00.000s</div>
    `;

    bar.appendChild(timerBox);
    form.appendChild(bar);

    // events ديال التايمر
    const secInput  = timerBox.querySelector("#__cal_tgt_sec");
    const msInput   = timerBox.querySelector("#__cal_tgt_ms");
    const startBtn  = timerBox.querySelector("#__cal_timer_start");
    const stopBtn   = timerBox.querySelector("#__cal_timer_stop");

    startBtn.addEventListener("click", () => {
      let sec = parseInt(secInput.value, 10);
      let ms  = parseInt(msInput.value, 10);

      if (isNaN(sec) || sec < 0 || sec > 59) sec = 0;
      if (isNaN(ms)  || ms < 0  || ms > 999) ms  = 0;

      secInput.value = String(sec);
      msInput.value  = String(ms);

      // لازم تختار slot مرة واحدة قبل تشغيل التايمر
      if (!__selectedSlotId) {
        showToast("select slot first", "limit");
        return;
      }

      scheduleTargetTimer(sec, ms);
    });

    stopBtn.addEventListener("click", () => {
      stopTargetTimer();
    });

    return true;
  }

  // =======================================================
  // SAMURAI MODE
  // =======================================================
  function initSamuraiMode() {
    try {
      chrome.storage?.local.get(MODE_KEY, (res) => {
        const mode = res?.[MODE_KEY] || "single";
        SAMURAI_ALL_MODE = (mode === "all");
      });

      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[MODE_KEY]) {
          const v = changes[MODE_KEY].newValue;
          SAMURAI_ALL_MODE = (v === "all");
        }
      });
    } catch {}
  }

  // =======================================================
  // AUTO SEQUENCE (delay + تكرار الطلبات)
  // =======================================================
  async function runAutoSequence() {
    const repeat = AUTO_REPEAT_COUNT || 1;
    log("Auto sequence start. delay(ms):", AUTO_DELAY_MS, "repeat:", repeat);

    for (let i = 0; i < repeat; i++) {
      if (i === 0) {
        // أول طلب: يستعمل الـ delay مع العد التنازلي في الزر
        if (AUTO_DELAY_MS > 0) {
          await new Promise(resolve => startInlineCountdownAlways(AUTO_DELAY_MS, resolve));
        }
      } else {
        // الطلبات الإضافية: ننتظر REPEAT_GAP_MS فقط بدون عداد في الزر
        if (REPEAT_GAP_MS > 0) {
          await sleep(REPEAT_GAP_MS);
        }
      }

      if (SAMURAI_ALL_MODE) await postAllOpenSlotsAuto();
      else await submitOneHour();
    }

    log("Auto sequence finished");
  }

  function raceGetSlotsOnFirstDays(availDays, maxDays = 3, onWinnerReady) {
    if (!__tpl) return;
    if (!Array.isArray(availDays) || !availDays.length) return;
  
    const chosen = availDays.slice(0, maxDays);
    if (!chosen.length) return;
  
    const PER_TIMEOUT_MS = 1000;
  
    __raceWinnerReady = false;
  
    // نخزنو أول نجاح من 1/2 كـ backup فقط (بدون ما نطلقو POST)
    let backup = null; // { dateText, json }
  
    (async () => {
      for (let idx = 0; idx < chosen.length; idx++) {
        const d = chosen[idx];
        if (!d || !d.DateText) continue;
  
        const dateText = d.DateText;
        const isLast = (idx === chosen.length - 1);
  
        const ctrl = new AbortController();
  
        // timeout غير للأولين
        let t = null;
        if (!isLast) {
          t = setTimeout(() => {
            try { ctrl.abort(); } catch {}
          }, PER_TIMEOUT_MS);
        }
  
        console.log("[CALENDRIA][DynSlots] race try", idx + 1, "/", chosen.length, dateText, isLast ? "(LAST no-abort)" : "");
  
        try {
          const j = await fetchSlotsForDate(__tpl, dateText, ctrl.signal, true);
          if (t) clearTimeout(t);
  
          // إذا ماشي الأخير: خزن النتيجة فقط وما تدير لا render لا unlock
          if (!isLast) {
            backup = { dateText, json: j };
            console.log("[CALENDRIA][DynSlots] got early response (backup only) for", dateText);
            continue;
          }
  
          const openSlots = parseOpenSlots(j);
          if (!openSlots.length) {
            console.warn("[CALENDRIA][DynSlots] last GET answered but no open slots -> keep locked");
            __raceWinnerReady = false;
            showToast("no open slots (last GET)", "limit");
            return;
          }

          const url = __tpl.prefix + encodeURIComponent(dateText) + __tpl.suffix;
  
          __raceWinnerReady = true;
          onAnyGetAvailableSlots(url, j);
  
          __lastRandomDayText = dateText;
          if (__dateEl) __dateEl.value = dateText;
  
          const trigger = document.getElementById("__cal_date_trigger");
          const popup   = document.getElementById("__cal_days_popup");
          if (trigger) trigger.textContent = dateText;
          if (popup) {
            popup.querySelectorAll(".cal-day-btn").forEach((btn) => {
              const dt = btn.dataset.dateText;
              if (!dt) return;
              btn.classList.toggle("cal-day-selected", dt === dateText);
            });
          }
  
          showToast(`slots loaded for ${dateText}`, "info");
          if (typeof onWinnerReady === "function") onWinnerReady(dateText);
          return;
  
        } catch (err) {
          if (t) clearTimeout(t);
  
          if (err && err.name === "AbortError") {
            console.warn("[CALENDRIA][DynSlots] timeout for", dateText);
            continue;
          }
  
          console.warn("[CALENDRIA][DynSlots] error for", dateText, err);
  
          if (isLast && backup) {
            const bDate = backup.dateText;
            const bJson = backup.json;
          
            const openSlotsB = parseOpenSlots(bJson);
            if (!openSlotsB.length) {
              console.warn("[CALENDRIA][DynSlots] backup has no open slots -> keep locked");
              __raceWinnerReady = false;
              showToast("no open slots (backup)", "limit");
              return;
            }
          
            const url = __tpl.prefix + encodeURIComponent(bDate) + __tpl.suffix;
          
            __raceWinnerReady = true;
            onAnyGetAvailableSlots(url, bJson);
          
            __lastRandomDayText = bDate;
            if (__dateEl) __dateEl.value = bDate;
          
            const trigger = document.getElementById("__cal_date_trigger");
            const popup   = document.getElementById("__cal_days_popup");
            if (trigger) trigger.textContent = bDate;
            if (popup) {
              popup.querySelectorAll(".cal-day-btn").forEach((btn) => {
                const dt = btn.dataset.dateText;
                if (!dt) return;
                btn.classList.toggle("cal-day-selected", dt === bDate);
              });
            }
          
            showToast(`slots loaded for ${bDate} (backup)`, "info");
            if (typeof onWinnerReady === "function") onWinnerReady(bDate);
            return;
          }

  
          continue;
        }
      }
  
      console.warn("[CALENDRIA][DynSlots] no winner (last failed and no backup).");
    })();
  }
  // ==========================
  // SAMURAI TIMES (before/after) UI
  // ==========================
  function ensureSamuraiTimesBox() {
    let box = document.getElementById("__cal_samurai_times");
    if (box) return box;
  
    box = document.createElement("div");
    box.id = "__cal_samurai_times";
    box.className = "cal-samurai-times";
  
    box.innerHTML = `
      <div class="cal-samurai-row">
        <span class="cal-samurai-label">click at :</span>
        <span class="cal-samurai-value" id="__cal_samurai_before">--:--:--.---</span>
      </div>
      <div class="cal-samurai-row">
        <span class="cal-samurai-label">enter at :</span>
        <span class="cal-samurai-value" id="__cal_samurai_after">--:--:--.---</span>
      </div>
    `;
  
    // نحطّو قبل كارت التاريخ (في نفس mb-3 ديال Appointment Date)
    const anchor =
      __dateEl?.closest(".mb-3") ||
      (document.querySelector("form") || document.body);
  
    anchor.insertAdjacentElement("afterbegin", box);
    return box;
  }
  
  function readSamuraiTimes() {
    const before = localStorage.getItem("samurai_before") || "";
    const after  = localStorage.getItem("samurai_after")  || "";
    return { before, after };
  }
  
  function updateSamuraiTimesBox() {
    ensureSamuraiTimesBox();
  
    const { before, after } = readSamuraiTimes();
    const bEl = document.getElementById("__cal_samurai_before");
    const aEl = document.getElementById("__cal_samurai_after");
  
    if (bEl) bEl.textContent = before ? before : "--:--:--.---";
    if (aEl) aEl.textContent = after  ? after  : "--:--:--.---";
  
    // optional: لون خفيف ملي كيتحدّث
    const box = document.getElementById("__cal_samurai_times");
    if (box) {
      box.classList.remove("cal-samurai-pulse");
      void box.offsetWidth;
      box.classList.add("cal-samurai-pulse");
    }
  }
  
  function startSamuraiTimesWatcher() {
    if (window.__cal_samurai_times_watcher) return;
    window.__cal_samurai_times_watcher = true;
  
    let lastB = null, lastA = null;
  
    setInterval(() => {
      const { before, after } = readSamuraiTimes();
      if (before !== lastB || after !== lastA) {
        lastB = before;
        lastA = after;
        updateSamuraiTimesBox();
      }
    }, 250);
  }

  // =======================================================
  // BOOT
  // =======================================================
  async function boot() {
    injectCssFileOnce();
    installInterceptors();
    initSamuraiMode();
    
    removeOriginalSubmit();

    const ok = injectButtons();
    if (!ok) return setTimeout(boot, 200);
    
    await ensureStableNamesReady();
    hookKendoOpenForSlotsOnce();

    updateSamuraiTimesBox();
    startSamuraiTimesWatcher();
    
    const avail = extractAvailDates();
    __tpl = extractGetSlotsTemplate();
    if (!avail || !__tpl) return;

    const availDays = getAvailableDays(avail);
    if (!availDays.length) return;

    hideOriginalDateWidget();
    ensureDaysPicker(availDays);

    // فاش ندخل الصفحة: ندير سباق بين 3 تواريخ
    raceGetSlotsOnFirstDays(availDays, 3, () => {
      // غير من بعد ما الرابح ديال GET يكمّل، نشغل AUTO إذا مفعّل
      if (AUTO_ENABLED) {
        runAutoSequence().catch(e => warn("Auto sequence error", e));
      }
    });
  }

  boot();

})();






