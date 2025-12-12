(() => {
  "use strict";

  if (!location.pathname.toLowerCase().includes("/mar/appointment/slotselection")) {
    return;
  }

  console.log("[STEP1] calendar selector started");

  /* ===============================
     1️⃣ نلقاو الكاليندار الحقيقي
     =============================== */
  function getRealCalendarContainer() {
    const containers = Array.from(
      document.querySelectorAll('.k-animation-container')
    );

    return containers.find(c => {
      const style = getComputedStyle(c);
      if (style.display === "none") return false;
      if (c.getAttribute("aria-hidden") === "true") return false;
      return c.querySelector(".k-widget.k-calendar");
    }) || null;
  }

  /* ===============================
     2️⃣ استخراج الأيام المتاحة
     =============================== */
  function getAvailableDays(calendarRoot) {
    if (!calendarRoot) return [];

    return Array.from(
      calendarRoot.querySelectorAll('a.k-link[data-value]')
    ).filter(a => {
      if (a.closest("td")?.classList.contains("k-state-disabled")) return false;
      if (a.getAttribute("tabindex") === "-1") return false;
      return true;
    });
  }

  /* ===============================
     3️⃣ اختيار يوم عشوائي
     =============================== */
  function pickRandomDay(days) {
    if (!days.length) return null;
    return days[Math.floor(Math.random() * days.length)];
  }

  /* ===============================
     4️⃣ تنفيذ onclick الحقيقي
     =============================== */
  function clickDay(dayEl) {
    if (!dayEl) return;

    console.log("[STEP1] clicking day:", dayEl.dataset.value);

    dayEl.scrollIntoView({ block: "center" });

    dayEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    dayEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    dayEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  /* ===============================
     5️⃣ BOOT
     =============================== */
  function bootTry() {
    const cont = getRealCalendarContainer();
    if (!cont) return false;

    const calendar = cont.querySelector(".k-widget.k-calendar");
    const days = getAvailableDays(calendar);

    console.log("[STEP1] available days:", days.length);

    if (!days.length) return false;

    const chosen = pickRandomDay(days);
    clickDay(chosen);

    console.log("[STEP1] done ✔️");
    return true;
  }

  /* ===============================
     6️⃣ retry حتى يحمّل DOM
     =============================== */
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (bootTry() || tries > 30) {
      clearInterval(iv);
    }
  }, 200);

})();
