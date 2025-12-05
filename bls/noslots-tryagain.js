(function () {
  "use strict";

  if (window.__calendria_noslots_retry_started) return;
  window.__calendria_noslots_retry_started = true;

  const LOG = "[CALENDRIA][NoSlotsRetry]";
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  const ALERT_TEXT_SNIPPET = "currently, no slots are available";
  const TRY_AGAIN_HREF_SNIPPET = "/mar/appointment/newappointment";

  let observer = null;
  let alreadyClicked = false;

  function normalize(str) {
    return (str || "").toString().trim().toLowerCase();
  }

  function findNoSlotsAlert() {
    const alerts = document.querySelectorAll(".alert.alert-danger, .alert-danger");
    for (const a of alerts) {
      const txt = normalize(a.innerText || a.textContent);
      if (txt.includes(ALERT_TEXT_SNIPPET)) {
        return a;
      }
    }
    return null;
  }

  function findTryAgainButton() {
    // نبحث عن أي زر كيبان عليه Try Again ويرجع لـ newappointment
    const anchors = document.querySelectorAll("a.btn, a.btn-primary");
    for (const a of anchors) {
      const href = (a.getAttribute("href") || "").toLowerCase();
      const txt  = normalize(a.innerText || a.textContent || a.value);
      if (!href) continue;

      if (href.includes(TRY_AGAIN_HREF_SNIPPET) && txt.includes("try again")) {
        return a;
      }
    }
    return null;
  }

  function tryClickTryAgain() {
    if (alreadyClicked) return;

    const alertEl = findNoSlotsAlert();
    if (!alertEl) return; // ما كايناش الرسالة → ما ندير والو

    const btn = findTryAgainButton();
    if (!btn) {
      warn("NoSlots alert detected but 'Try Again' button not found yet");
      return;
    }

    alreadyClicked = true;
    log("NoSlots alert detected → auto click TRY AGAIN", btn);
    try {
      btn.click();
    } catch (e) {
      console.error(LOG, "error clicking Try Again:", e);
    }

    // من بعد الضغط نسدّ المراقبة
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // محاولة فورية (يمكن تكون الرسالة ظاهرة من قبل)
  tryClickTryAgain();

  // مراقبة DOM حتى إذا ظهرت الرسالة لاحقاً
  observer = new MutationObserver(() => {
    tryClickTryAgain();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  log("NoSlotsRetry script loaded (idle until 'no slots' alert appears)");
})();
