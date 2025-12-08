(function () {
  "use strict";

  if (window.__samurai_global_retry) return;
  window.__samurai_global_retry = true;

  const LOG  = "[SAMURAI][GLOBAL-RETRY]";
  const log  = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  // حماية من التكرار
  let noSlotHandled       = false;
  let formWarningHandled  = false;

  const MYAPPTS_URL = "https://www.blsspainmorocco.net/MAR/appointmentdata/myappointments";

  // قراءة نصوص الصفحة
  function getPageTextLower() {
    try { return document.body.innerText.toLowerCase(); }
    catch { return ""; }
  }

  // =====================================================
  // 1️⃣ NO SLOTS — يشتغل في أي صفحة يظهر فيها "no slots"
  // =====================================================
  function handleNoSlotsIfAny() {
    if (noSlotHandled) return false;

    const text = getPageTextLower();
    if (!text.includes("no slots") && !text.includes("currently, no slots")) {
      return false;
    }

    // نبحث عن Try Again
    const retry = document.querySelector(
      `a[href*="NewAppointment"], 
       a[href*="newappointment"],
       button[onclick*="NewAppointment"],
       button[formaction*="NewAppointment"]`
    );

    if (retry) {
      noSlotHandled = true;
      log("NO SLOTS detected → clicking TRY AGAIN");

      try { retry.click(); }
      catch (e) { warn("TryAgain click failed:", e); }

      return true;
    }

    return false;
  }

  // ===============================================================
  // 2️⃣ FORM-INCOMPLETE — redirect فعلي نحو /myappointments
  // ===============================================================

  const WARNING_SNIPPET   = "you have not filled out and completed the applicant";
  const BUTTON_TEXT_SNIP  = "click here to complete application form";

  function handleFormIncompleteIfAny() {
    if (formWarningHandled) return false;

    const txt = getPageTextLower();

    const btn = [...document.querySelectorAll("button, a")]
      .find(el => (el.innerText || "").trim().toLowerCase().includes(BUTTON_TEXT_SNIP));

    // إذا ظهرت الرسالة أو الزر → نذهب مباشرة لصفحة myappointments
    if (!txt.includes(WARNING_SNIPPET) && !btn) return false;

    formWarningHandled = true;

    log("FORM-INCOMPLETE detected → redirecting to /myappointments");

    // 🚀 الدخول فعلياً للصفحة — بدون fetch
    window.location.href = MYAPPTS_URL;

    return true;
  }

  // ===============================
  // تشغيل الفحص + مراقبة DOM
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
