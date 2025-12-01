// == CALENDRIA – NewAppointment Auto REFRESH/RETRY ==
// يعمل فقط إذا ظهرت رسالة "no slots available"

(() => {
  "use strict";

  if (window.__samurai_newappt_started) return;
  window.__samurai_newappt_started = true;

  const PATH_OK = location.pathname.toLowerCase().includes("/mar/appointment/newappointment");
  if (!PATH_OK) return;

  console.log("%c[SAMURAI][NewAppointment] Watcher injected", "color:#0ff;font-size:14px;");

  // النص الذي سنبحث عنه
  const ERROR_TEXT = "no slots are available for the selected category";

  // URL الذي سنرسل له fetch
  const TARGET_URL = "https://www.blsspainmorocco.net/MAR/appointment/newappointment";

  function detectError() {
    const bodyText = document.body.innerText.toLowerCase();

    if (bodyText.includes(ERROR_TEXT)) {
      console.log("[SAMURAI][NewAppointment] Error detected → sending fetch retry...");
      sendRetryFetch();
      return true;
    }
    return false;
  }

  async function sendRetryFetch() {
    try {
      const resp = await fetch(TARGET_URL, {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        redirect: "manual"
      });

      console.log("[SAMURAI][NewAppointment] fetch status:", resp.status);

      const loc = resp.headers.get("Location") || "";
      const abs = loc ? new URL(loc, location.origin).toString() : "";

      if (resp.status >= 300 && resp.status < 400 && abs) {
        console.log("[SAMURAI][NewAppointment] following redirect →", abs);
        location.href = abs;
        return;
      }

      // إذا لم يكن redirect → أعد تحميل الصفحة
      console.log("[SAMURAI][NewAppointment] reloading page …");
      location.reload();

    } catch (e) {
      console.error("[SAMURAI][NewAppointment] fetch error:", e);
      location.reload();
    }
  }

  // نستخدم MutationObserver لأن الصفحة تظهر الرسالة بعد تحميل HTML
  const obs = new MutationObserver(() => {
    detectError();
  });

  obs.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // محاولة أولية
  setTimeout(detectError, 300);
})();
