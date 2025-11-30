(() => {
  "use strict";

  const path = location.pathname.toLowerCase();
  const PATH_OK =
    path.includes("/mar/appointment/applicantselection") ||
    path.includes("/mar/appointment/liveness") ||
    path.includes("/mar/appointment/payment");

  if (!PATH_OK) return;

  if (window.__calendria_applicant_info_started) return;
  window.__calendria_applicant_info_started = true;

  const LAST_SELECTION_KEY = "calendria_last_slot_selection";

  function log(...a) {
    console.log(
      "%c[CALENDRIA][ApplicantInfo]",
      "color:#facc15;font-weight:bold;",
      ...a
    );
  }
  function warn(...a) {
    console.warn("[CALENDRIA][ApplicantInfo]", ...a);
  }

  // =========================================
  // CSS من الإضافة (applicant.css)
  // =========================================
  function injectCssOnce() {
    if (document.getElementById("__cal_applicant_css")) return;

    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === "function"
      ) {
        const link = document.createElement("link");
        link.id = "__cal_applicant_css";
        link.rel = "stylesheet";
        link.href = chrome.runtime.getURL("applicant.css");
        document.head.appendChild(link);
      }
    } catch (e) {
      console.warn("[CALENDRIA][Applicant] CSS inject skipped:", e);
    }
  }

  // ----------------------------
  // قراءة location / visasubtype / category من storage ديال الإضافة
  // ----------------------------
  function readPopupMeta(callback) {
    if (!chrome?.storage?.local) {
      callback({
        location: "",
        visasubtype: "",
        category: ""
      });
      return;
    }

    chrome.storage.local.get(
      [
        "calendria_location_name",
        "calendria_visasub_name",
        "calendria_category_name"
      ],
      (res = {}) => {
        const meta = {
          location:    (res.calendria_location_name || "").toString().trim(),
          visasubtype: (res.calendria_visasub_name  || "").toString().trim(),
          category:    (res.calendria_category_name || "").toString().trim()
        };
        log("popup meta:", meta);
        callback(meta);
      }
    );
  }

  // ----------------------------
  // قراءة اليوم و الساعة من localStorage (calendria_last_slot_selection)
  // ----------------------------
  function readLastSelection() {
    try {
      if (!window.localStorage) return null;
      const raw = localStorage.getItem(LAST_SELECTION_KEY);
      if (!raw) return null;

      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = raw;
      }

      if (data && typeof data === "object") {
        const date =
          data.date ||
          data.day ||
          data.dayText ||
          data.selectedDate ||
          data.dateText ||
          "";
        const slot =
          data.slot ||
          data.time ||
          data.timeText ||
          data.selectedSlot ||
          data.slotText ||
          "";
        return { date: String(date || ""), slot: String(slot || "") };
      }

      // مجرد سترينغ
      return { date: String(data || ""), slot: "" };
    } catch (e) {
      warn("readLastSelection error", e);
      return null;
    }
  }

  // ----------------------------
  // فين ندرج البوكسات فكل صفحة؟
  // ----------------------------
  function findInsertPoint() {
    const p = location.pathname.toLowerCase();

    // ApplicantSelection: تحت اللوغو
    if (p.includes("/mar/appointment/applicantselection")) {
      return document.querySelector("div.text-center.col-12") || null;
    }

    // Liveness: تحت العنوان
    if (p.includes("/mar/appointment/liveness")) {
      const h5List = Array.from(document.querySelectorAll("h5"));
      const h5 = h5List.find((el) =>
        /liveness detection/i.test(el.textContent || "")
      );
      if (h5) {
        const row = h5.closest(".col-12.row") || h5.closest(".row");
        return row || null;
      }
    }

    // Payment: تحت العنوان
    if (p.includes("/mar/appointment/payment")) {
      const h5List = Array.from(document.querySelectorAll("h5"));
      const h5 = h5List.find((el) =>
        /payment confirmation/i.test(el.textContent || "")
      );
      if (h5) {
        const row = h5.closest(".col-12.row") || h5.closest(".row");
        return row || null;
      }
    }

    return null;
  }

  // ----------------------------
  // بناء البوكسات (صف أصفر + صف أخضر)
  // ----------------------------
  function buildInfoBoxes(sel, meta) {
    const wrap = document.createElement("div");
    wrap.className = "cal-app-info-wrap";

    const inner = document.createElement("div");
    inner.className = "cal-app-info-inner";

    // ========== الصف العلوي (أصفر) DATE / SLOT ==========
    const rowTop = document.createElement("div");
    rowTop.className = "cal-app-row cal-app-row-main";

    // DATE box
    const boxDate = document.createElement("div");
    boxDate.className = "cal-app-box";
    const lblDate = document.createElement("div");
    lblDate.className = "cal-app-label";
    lblDate.textContent = "DATE";
    const valDate = document.createElement("div");
    valDate.className = "cal-app-value";
    valDate.textContent = sel.date || "-";
    boxDate.appendChild(lblDate);
    boxDate.appendChild(valDate);

    // SLOT box
    const boxSlot = document.createElement("div");
    boxSlot.className = "cal-app-box";
    const lblSlot = document.createElement("div");
    lblSlot.className = "cal-app-label";
    lblSlot.textContent = "SLOT";
    const valSlot = document.createElement("div");
    valSlot.className = "cal-app-value";
    valSlot.textContent = sel.slot || "-";
    boxSlot.appendChild(lblSlot);
    boxSlot.appendChild(valSlot);

    rowTop.appendChild(boxDate);
    rowTop.appendChild(boxSlot);

    // ========== الصف السفلي (أخضر) LOCATION / VISA / CATEGORY ==========
    const rowBottom = document.createElement("div");
    rowBottom.className = "cal-app-row cal-app-row-sub";

    function makeGreenBox(labelText, valueText) {
      const box = document.createElement("div");
      box.className = "cal-app-box cal-app-box-green cal-app-box-small";

      const lbl = document.createElement("div");
      lbl.className = "cal-app-label";
      lbl.textContent = labelText;

      const val = document.createElement("div");
      val.className = "cal-app-value";
      val.textContent = valueText || "-";

      box.appendChild(lbl);
      box.appendChild(val);
      return box;
    }

    const boxLoc = makeGreenBox("location :", meta.location || "");
    const boxSub = makeGreenBox("visasubtype :", meta.visasubtype || "");
    const boxCat = makeGreenBox("category :", meta.category || "");

    rowBottom.appendChild(boxLoc);
    rowBottom.appendChild(boxSub);
    rowBottom.appendChild(boxCat);

    inner.appendChild(rowTop);
    inner.appendChild(rowBottom);
    wrap.appendChild(inner);

    return wrap;
  }

  // ----------------------------
  // إدراج البوكسات
  // ----------------------------
  function injectBoxesWithMeta() {
    const sel = readLastSelection();
    if (!sel) {
      log("No last selection found in localStorage");
      return;
    }

    const anchor = findInsertPoint();
    if (!anchor || !anchor.parentElement) {
      warn("Anchor block not found, cannot inject boxes");
      return;
    }

    if (document.getElementById("__cal_applicant_info")) return;

    readPopupMeta((meta) => {
      const boxes = buildInfoBoxes(sel, meta);
      boxes.id = "__cal_applicant_info";

      anchor.insertAdjacentElement("afterend", boxes);
      log("Injected Applicant info boxes", { sel, meta });
    });
  }

  // ==========================================================
  // PAYMENT (نفس المنطق القديم ديال VAS + MESSAGE)
  // ==========================================================
  function collectFieldValue(name) {
    const el =
      document.querySelector(`[name="${name}"]`) ||
      document.getElementById(name);
    return el ? (el.value ?? "").toString() : "";
  }

  function getVerificationToken() {
    return (
      collectFieldValue("__RequestVerificationToken") ||
      (document.querySelector('input[name="__RequestVerificationToken"]')
        ?.value || "")
    );
  }

  function resolvePaymentUrl() {
    const f =
      document.querySelector('form[action*="ValueAdded"]') ||
      document.querySelector('form[action*="Payment"]') ||
      document.querySelector("form");
    if (f && f.getAttribute("action")) {
      let act = f.getAttribute("action");
      if (!/^https?:/i.test(act)) {
        if (!act.startsWith("/"))
          act = "/MAR/Appointment/" + act.replace(/^\.?\//, "");
        return act;
      }
      return act;
    }
    return "/MAR/Appointment/Payment";
  }

  function buildValueAddedServices() {
    const parts = [];
    const boxes = document.querySelectorAll(
      '.vac-check[type="checkbox"], input.vac-check[type="checkbox"]'
    );
    boxes.forEach((cb) => {
      if (!cb) return;

      const idAttr = cb.id || "";
      let guid = idAttr.startsWith("chk_") ? idAttr.slice(4) : idAttr;
      if (!guid) return;

      const isMandatory =
        cb.dataset.isMandatory === "True" || cb.dataset.isMandatory === "true";
      const isPayable =
        cb.dataset.isPayable === "True" || cb.dataset.isPayable === "true";

      if (!isPayable) return;
      if (!isMandatory && !cb.checked) return;

      let qty = 1;
      const numEl =
        document.getElementById("num_" + guid) ||
        document.querySelector(`#num_${CSS.escape(guid)}`);
      if (numEl) {
        const v = parseInt(numEl.value, 10);
        if (!Number.isNaN(v) && v > 0) qty = v;
      }

      parts.push(`${guid}_${qty}_undefined`);
    });

    return parts.join(",");
  }

  function showPaymentSentMessage() {
    const p = location.pathname.toLowerCase();
    if (!p.includes("/mar/appointment/payment")) return;
    if (document.getElementById("__cal_payment_msg")) return;

    const box = document.createElement("div");
    box.id = "__cal_payment_msg";
    box.textContent = "PAYMENT REQUEST HAS BEEN SEND";

    box.style.position = "fixed";
    box.style.top = "10px";
    box.style.right = "10px";
    box.style.zIndex = "99999";
    box.style.background = "#22c55e";
    box.style.color = "#ffffff";
    box.style.padding = "8px 14px";
    box.style.borderRadius = "999px";
    box.style.fontSize = "13px";
    box.style.fontWeight = "600";
    box.style.boxShadow = "0 4px 10px rgba(0,0,0,0.25)";

    document.body.appendChild(box);

    setTimeout(() => {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 6000);
  }

  let __paymentPosted = false;

  async function autoSendPaymentVAS() {
    if (__paymentPosted) return;
    const p = location.pathname.toLowerCase();
    if (!p.includes("/mar/appointment/payment")) return;

    const idVal = collectFieldValue("Id");
    const vasVal = buildValueAddedServices();
    const dataVal = collectFieldValue("Data");
    const token = getVerificationToken();

    if (!idVal || !dataVal || !token) {
      warn("Payment VAS: some required fields missing", {
        idVal,
        dataVal,
        tokenPresent: !!token,
      });
      return;
    }

    const url = resolvePaymentUrl();
    log("Payment VAS FETCH →", url, "VAS =", vasVal);

    __paymentPosted = true;
    showPaymentSentMessage();

    const body = new URLSearchParams();
    body.append("Id", idVal);
    if (vasVal) body.append("ValueAddedServices", vasVal);
    body.append("Data", dataVal);
    body.append("__RequestVerificationToken", token);

    try {
      const resp = await fetch(url, {
        method: "POST",
        credentials: "include",
        redirect: "manual",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/plain, */*",
        },
        body: body.toString(),
      });

      let targetUrl = null;

      const ct = (resp.headers.get("Content-Type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          const json = await resp.json();
          log("Payment JSON response:", json);
          if (
            json &&
            typeof json.requestURL === "string" &&
            json.requestURL
          ) {
            targetUrl = json.requestURL;
          }
        } catch (e) {
          warn("Payment: JSON parse failed", e);
        }
      }

      if (!targetUrl) {
        const loc = resp.headers.get("Location");
        if (loc) {
          try {
            targetUrl = new URL(loc, location.origin).toString();
          } catch {
            targetUrl = loc;
          }
        }
      }

      if (targetUrl) {
        log("Payment: navigating to payment URL:", targetUrl);
        window.location.href = targetUrl;
      } else {
        warn(
          "Payment: no requestURL or Location in response, staying on page."
        );
        __paymentPosted = false;
      }
    } catch (e) {
      warn("Payment VAS fetch error:", e);
      __paymentPosted = false;
    }
  }

  // ==========================================================
  // BOOT
  // ==========================================================
  function boot() {
    injectCssOnce();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        injectBoxesWithMeta();
        autoSendPaymentVAS();
      });
    } else {
      injectBoxesWithMeta();
      autoSendPaymentVAS();
    }
  }

  boot();
})();
