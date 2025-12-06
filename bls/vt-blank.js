(function () {
  "use strict";

  window.addEventListener("CAL_VT_SLOTS_302", (ev) => {
    console.log("[VT-BLANK] CAL_VT_SLOTS_302 received:", ev && ev.detail);
    try {
      const blankUrl = chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL("ui/slot-blank.html")
        : "about:blank";
      location.href = blankUrl;
    } catch (e) {
      location.href = "about:blank";
    }
  });
})();
