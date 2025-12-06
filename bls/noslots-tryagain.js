(function () {
  "use strict";

  if (window.__calendria_noslots_retry_started) return;
  window.__calendria_noslots_retry_started = true;

  const LOG  = "[CALENDRIA][NoSlotsRetry]";
  const log  = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  const NO_SLOTS_TEXT_SNIPPET      = "currently, no slots are available";
  const INVALID_CAPTCHA_TEXT_SNIP  = "the captcha you submitted is invalid";
  const NEW_APPOINTMENT_URL        =
    "https://www.blsspainmorocco.net/MAR/appointment/newappointment";
  const TRY_AGAIN_HREF_SNIPPET     = "/mar/appointment/newappointment";

  let observer       = null;
  let actionDone     = false; // باش مايتعاودش لا كليك لا ريديركت

  function getAlertsTextLower() {
    try {
      const alerts = Array.from(
        document.querySelectorAll(
          ".alert, .alert-warning, .alert-danger, .col-12.alert, .col-12.alert-warning"
        )
      );
      return alerts
        .map((el) => (el.textContent || "").trim().toLowerCase())
        .join(" ");
    } catch (e) {
      warn("getAlertsTextLower error:", e);
      return "";
    }
  }

  function tryHandleInvalidCaptcha() {
    const allText = getAlertsTextLower();
    if (!allText) return false;

    if (allText.includes(INVALID_CAPTCHA_TEXT_SNIP)) {
      log("Detected 'The captcha you submitted is invalid' → redirecting to NewAppointment");
      actionDone = true;
      try {
        if (observer) observer.disconnect();
      } catch (e) {}
      // إعادة التوجيه مباشرة
      window.location.assign(NEW_APPOINTMENT_URL);
      return true;
    }
    return false;
  }

  function tryHandleNoSlotsClick() {
    const allText = getAlertsTextLower();
    if (!allText) return false;

    if (!allText.includes(NO_SLOTS_TEXT_SNIPPET)) {
      return false;
    }

    // نحاول نلقاو زر/لينك "Try again" اللي كيمشي لـ NewAppointment
    const retryLink =
      document.querySelector(`a[href*="${TRY_AGAIN_HREF_SNIPPET}"]`) ||
      document.querySelector(`button[onclick*="NewAppointment"]`) ||
      document.querySelector(`button[formaction*="${TRY_AGAIN_HREF_SNIPPET}"]`);

    if (!retryLink) {
      warn("No-slots alert found but retry link not found yet");
      return false;
    }

    log("Found 'no slots' alert + retry link → clicking it once");
    try {
      retryLink.click();
    } catch (e) {
      try {
        retryLink.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      } catch (e2) {
        warn("Failed to click retry link:", e2);
      }
    }
    actionDone = true;
    try {
      if (observer) observer.disconnect();
    } catch (e) {}
    return true;
  }

  function checkPage() {
    if (actionDone) return;

    // 1️⃣ أولوية لرسالة الكابتشا غير صحيحة → ريديركت مباشر
    if (tryHandleInvalidCaptcha()) return;

    // 2️⃣ إذا ماكايناش رسالة كابتشا، نشوف "no slots" ونكليك على try-again
    tryHandleNoSlotsClick();
  }

  // نجرّب مباشرة بعد تحميل السكربت
  setTimeout(checkPage, 50);

  // مراقبة الـ DOM حتى إذا ظهرت الرسالة لاحقاً (AJAX أو تحديث جزئي)
  try {
    observer = new MutationObserver(() => {
      checkPage();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    warn("MutationObserver error:", e);
  }

  log(
    "NoSlotsRetry script loaded (watching for 'no slots' and 'captcha invalid' alerts)"
  );
})();
