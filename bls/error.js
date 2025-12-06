(function () {
  "use strict";

  if (window.__calendria_error_watcher_started) return;
  window.__calendria_error_watcher_started = true;

  const LOG = "[CALENDRIA][ErrorWatcher]";
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  const ERROR_PHRASES = [
    "504 gateway time-out",
    "application temporarily unavailable",
    "502 bad gateway",
    "503 service temporarily unavailable",
    "service temporarily unavailable",
    "service unavailable",
    "500 internal server error",
    "database error",
    "fastcgi error",
    "the connection has timed out",
    "problemas al cargar la página",
    "error 502 (server error)!!1"
  ];

  function pageHasError() {
    try {
      const bodyText =
        (document.body && document.body.innerText) ? document.body.innerText : "";
      const titleText = document.title || "";
      const all = (bodyText + " " + titleText).toLowerCase();

      return ERROR_PHRASES.some((p) => all.includes(p));
    } catch (e) {
      warn("pageHasError error:", e);
      return false;
    }
  }

  function loadErrorSettings(cb) {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        // في حالة الصفحة معمولة بالـ prelude، chrome.storage كاين
        cb({ enabled: false, intervalMs: 2000 });
        return;
      }
    } catch (e) {
      cb({ enabled: false, intervalMs: 2000 });
      return;
    }

    chrome.storage.local.get(
      ["calendria_error_enabled", "calendria_error_interval_sec"],
      (res = {}) => {
        const enabled = (res.calendria_error_enabled || "off") === "on";

        let raw = (res.calendria_error_interval_sec || "2")
          .toString()
          .trim()
          .replace(",", ".");
        let sec = parseFloat(raw);
        if (!isFinite(sec) || sec <= 0) sec = 2;

        cb({ enabled, intervalMs: Math.round(sec * 1000) });
      }
    );
  }

  function start() {
    loadErrorSettings(({ enabled, intervalMs }) => {
      if (!enabled) {
        log("Error auto-refresh disabled in settings");
        return;
      }

      if (!pageHasError()) {
        // ما كاين لا 502 لا 504 لا والو → ما ندير والو
        log("No error phrase detected on this page");
        return;
      }

      log(
        `Error phrase detected → will auto-refresh every ${intervalMs / 1000}s until الصفحة ترجع طبيعية`
      );

      // نخلي انترفال واحد فقط
      if (window.__calendria_error_refresh_timer) return;

      window.__calendria_error_refresh_timer = setInterval(() => {
        // في كل دورة، كنعيد التحقق (في حالة تغيرت الصفحة بدون reload)
        if (!pageHasError()) {
          log("Error phrase disappeared → stopping auto-refresh");
          clearInterval(window.__calendria_error_refresh_timer);
          window.__calendria_error_refresh_timer = null;
          return;
        }

        log("Reloading page because error still present...");
        try {
          window.location.reload();
        } catch (e) {
          warn("reload() failed:", e);
        }
      }, intervalMs);
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(start, 200);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 200));
  }
})();
