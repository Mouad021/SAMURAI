(() => {
  "use strict";

  // نخدمو غير فـ SlotSelection
  if (!location.pathname.toLowerCase().includes("/appointment/slotselection")) {
    return;
  }

  const log  = (...a) => console.log("%c[CAL-DATE]", "color:#0ff;font-weight:bold;", ...a);
  const warn = (...a) => console.warn("[CAL-DATE]", ...a);

  /* =====================================================
     1) جلب availDates الحقيقي
     ===================================================== */
  function getAvailDates() {
    try {
      if (window.availDates && Array.isArray(window.availDates.ad)) {
        return window.availDates.ad;
      }
    } catch {}
    return [];
  }

  /* =====================================================
     2) الأيام المتاحة فقط (الخضر)
     AppointmentDateType === 0
     ===================================================== */
  function getAvailableDays(ad) {
    return ad.filter(d =>
      d &&
      d.AppointmentDateType === 0 &&
      d.DateText &&
      d.DateValue
    );
  }

  /* =====================================================
     3) تحديد input الأصلي الحقيقي (نفس منطقك القديم)
     ===================================================== */
  function getRealDateInput() {
    const inputs = Array.from(
      document.querySelectorAll('input[data-role="datepicker"], input.k-input')
    );

    const real = inputs.filter(inp => {
      if (!inp) return false;
      if (inp.disabled) return false;
      if (inp.offsetParent === null) return false; // مخفي
      if (!inp.name) return false;

      // ❌ استبعاد نسخ popup
      if (inp.closest('.k-animation-container, .k-calendar-container, .k-popup')) {
        return false;
      }

      // ✅ لازم يكون داخل DatePicker حقيقي
      if (!inp.closest('.k-datepicker, .k-widget.k-datepicker, .k-picker-wrap')) {
        return false;
      }

      return true;
    });

    // فضّل اللي عندو aria-owns ديال dateview
    real.sort((a, b) => {
      const ax = (a.getAttribute("aria-owns") || "").includes("_dateview") ? 1 : 0;
      const bx = (b.getAttribute("aria-owns") || "").includes("_dateview") ? 1 : 0;
      return bx - ax;
    });

    return real[0] || null;
  }

  /* =====================================================
     4) حقن التاريخ بالطريقة الصحيحة (Kendo + events)
     ===================================================== */
  function injectDate(input, day) {
    log("Injecting date:", day.DateText);

    // حقن بصري
    input.value = day.DateText;

    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // إذا Kendo موجود → استعمل API ديالو
    try {
      if (window.$) {
        const picker = $(input).data("kendoDatePicker");
        if (picker) {
          picker.value(new Date(day.DateText + "T00:00:00"));
          picker.trigger("change");
        }
      }
    } catch (e) {
      warn("Kendo inject failed", e);
    }
  }

  /* =====================================================
     5) BOOT
     ===================================================== */
  let tries = 0;
  const iv = setInterval(() => {
    tries++;

    const ad = getAvailDates();
    if (!ad.length) {
      if (tries > 30) clearInterval(iv);
      return;
    }

    const available = getAvailableDays(ad);
    if (!available.length) {
      warn("No available days");
      clearInterval(iv);
      return;
    }

    const input = getRealDateInput();
    if (!input) {
      if (tries > 30) {
        warn("Real date input not found");
        clearInterval(iv);
      }
      return;
    }

    const chosen = available[Math.floor(Math.random() * available.length)];
    injectDate(input, chosen);

    log("DONE ✔️ date selected:", chosen.DateText);
    clearInterval(iv);

  }, 200);

})();
