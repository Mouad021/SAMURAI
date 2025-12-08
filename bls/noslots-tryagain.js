(function () {
  "use strict";

  if (window.__samurai_global_retry) return;
  window.__samurai_global_retry = true;

  const LOG = "[SAMURAI][GLOBAL-RETRY]";
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  // ===============================
  // FLAGS لحماية الطلبات من التكرار
  // ===============================
  let noSlotHandled = false;
  let formWarningHandled = false;

  // ==========================================
  // 1) GET النصوص داخل ALERTS (lower-case)
  // ==========================================
  function getPageTextLower() {
    try {
      return document.body.innerText.toLowerCase();
    } catch {
      return "";
    }
  }

  // ==================================================================
  // 2) منطق NO SLOTS يعمل في أي صفحة يظهر فيها "no slots are available"
  // ==================================================================
  function handleNoSlotsIfAny() {
    if (noSlotHandled) return false;

    const text = getPageTextLower();
    if (!text.includes("no slots") && !text.includes("currently, no slots")) {
      return false;
    }

    // نحاول نضغط TRY AGAIN
    const retry = document.querySelector(
      `a[href*="newappointment"], button[onclick*="NewAppointment"], button[formaction*="newappointment"]`
    );

    if (retry) {
      noSlotHandled = true;

      log("NO SLOTS detected → clicking Try Again");
      try { retry.click(); }
      catch (e) { warn("retry click failed", e); }

      return true;
    }

    return false;
  }

  // ===============================================================================
  // 3) منطق صفحة "لم تكمل البيانات" يعمل في أي صفحة يظهر فيها التحذير أو الزر
  // ===============================================================================
  const WARNING_SNIPPET = "you have not filled out and completed the applicant";
  const BUTTON_TEXT_SNIP = "click here to complete application form";

  function handleFormIncompleteIfAny() {
    if (formWarningHandled) return false;

    const txt = getPageTextLower();

    const btn = [...document.querySelectorAll("button, a")]
      .find(el =>
        (el.innerText || "").trim().toLowerCase().includes(BUTTON_TEXT_SNIP)
      );

    if (!txt.includes(WARNING_SNIPPET) && !btn) return false;

    formWarningHandled = true;

    log("Detected FORM-INCOMPLETE warning → sending /myappointments request");

    fetch("https://www.blsspainmorocco.net/MAR/appointmentdata/myappointments", {
      method: "GET",
      credentials: "include",
      cache: "no-cache"
    })
      .then(r => log("MyAppointments status =", r.status))
      .catch(e => warn("MyAppointments error", e));

    return true;
  }

  // ===============================
  // تشغيل الفحص مباشرة + مراقبة DOM
  // ===============================
  function checkAll() {
    handleNoSlotsIfAny();
    handleFormIncompleteIfAny();
  }

  setTimeout(checkAll, 100);

  const obs = new MutationObserver(() => checkAll());
  obs.observe(document.body, { childList: true, subtree: true });

  log("GLOBAL RETRY SCRIPT ACTIVE (NoSlots + FormIncomplete)");
})();
