(() => {
  "use strict";

  if (!location.pathname.toLowerCase().includes("/mar/appointment/slotselection")) {
    return;
  }

  console.log("[STEP1] using availDates");

  /* ===============================
     1️⃣ نجيب availDates الحقيقي
     =============================== */
  function getAvailDates() {
    try {
      if (window.availDates && Array.isArray(window.availDates.ad)) {
        return window.availDates.ad;
      }
    } catch {}
    return [];
  }

  /* ===============================
     2️⃣ نفلتر الأيام المتاحة فقط
     AppointmentDateType === 0
     =============================== */
  function getAvailableDays(ad) {
    return ad.filter(d =>
      d &&
      d.AppointmentDateType === 0 &&
      d.DateValue &&
      d.DateText
    );
  }

  /* ===============================
     3️⃣ نلقاو input الحقيقي
     =============================== */
  function getDateInput() {
    return (
      document.querySelector('input[data-role="datepicker"]') ||
      document.querySelector('#AppointmentDate') ||
      document.querySelector('.k-datepicker input')
    );
  }

  /* ===============================
     4️⃣ نحقن اليوم + نطلق events
     =============================== */
  function setDate(input, day) {
    console.log("[STEP1] select date:", day.DateText, day.DateValue);

    // حقن القيمة اللي كيفهمها Kendo
    input.value = day.DateText; // yyyy-mm-dd (display)

    // events عادية
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // إذا Kendo موجود → change الحقيقي
    try {
      const picker = $(input).data("kendoDatePicker");
      if (picker) {
        picker.value(new Date(day.DateText));
        picker.trigger("change");
      }
    } catch {}

    return true;
  }

  /* ===============================
     5️⃣ BOOT
     =============================== */
  let tries = 0;
  const iv = setInterval(() => {
    tries++;

    const ad = getAvailDates();
    if (!ad.length) {
      if (tries > 20) clearInterval(iv);
      return;
    }

    const available = getAvailableDays(ad);
    console.log("[STEP1] available days:", available.length);

    if (!available.length) {
      clearInterval(iv);
      return;
    }

    const input = getDateInput();
    if (!input || input.disabled : false) return;

    const chosen = available[Math.floor(Math.random() * available.length)];
    setDate(input, chosen);

    console.log("[STEP1] DONE ✔️");
    clearInterval(iv);

  }, 200);

})();
