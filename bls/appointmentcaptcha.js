// == CALENDRIA AppointmentCaptcha – Fetch + Final URL Check ==
// - يحل الكابتشا بـ NoCaptchaAI (نفس منطق LoginCaptcha تقريباً)
// - يبني SelectedImages من الصور المختارة
// - يرسل POST عبر fetch لـ /MAR/Appointment/appointmentcaptcha
//   مع redirect: "follow"
// - إذا الرد النهائي هو VisaType → ندخلو لها
// - إذا أي صفحة أخرى → نبقى فـ NewAppointment و نرسل fetch إضافي لـ NewAppointment
(() => {
  "use strict";

  if (window.__calendria_apptcaptcha_started) return;
  window.__calendria_apptcaptcha_started = true;

  const href = (location.href || "").toLowerCase();
  if (!href.includes("/mar/appointment/newappointment")) return;

  const LOG  = "[CALENDRIA][ApptCaptcha]";
  const log  = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  // ===================== helpers: form + fields =====================

  function getForm() {
    return (
      document.querySelector('form[action*="appointmentcaptcha"]') ||
      document.querySelector("form")
    );
  }

  function getTokenValue() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el && el.value ? String(el.value) : "";
  }

  function getDataValue() {
    const el = document.querySelector('input[name="Data"]');
    return el && el.value ? String(el.value) : "";
  }

  function getClientDataValue() {
    const el = document.querySelector('input[name="ClientData"]');
    return el && el.value ? String(el.value) : "";
  }

  function getExtraInputs() {
    const extras = [];
    const ignore = new Set([
      "__RequestVerificationToken",
      "SelectedImages",
      "Data",
      "ClientData"
    ]);
    document
      .querySelectorAll('input[type="hidden"][name]')
      .forEach((inp) => {
        const name = inp.name;
        if (!name || ignore.has(name)) return;
        extras.push({ name, value: inp.value || "" });
      });
    return extras;
  }

  // ===================== grid/target – نفس LoginCaptcha =====================

  function getCaptchaGrid() {
    try {
      if (typeof $ === "function" && $.fn && $.fn.jquery) {
        return $(":has(> .captcha-img):visible")
          .get()
          .reduce((acc, cur) => {
            (acc[Math.floor(cur.offsetTop)] ??= []).push(cur);
            return acc;
          }, [])
          .flatMap((row) => {
            const sortedByZ = row.sort(
              (a, b) => getComputedStyle(b).zIndex - getComputedStyle(a).zIndex
            );
            const top3 = sortedByZ.slice(0, 3);
            const sortedByLeft = top3.sort(
              (a, b) => a.offsetLeft - b.offsetLeft
            );
            return sortedByLeft;
          })
          .map((el) => el.firstElementChild)
          .filter(Boolean);
      }
    } catch {}

    const containers = Array.from(document.querySelectorAll("*")).filter(
      (el) => {
        const c = el.firstElementChild;
        if (!c) return false;
        if (!c.classList || !c.classList.contains("captcha-img")) return false;
        const r = el.getClientRects();
        return r && r.length && el.offsetWidth && el.offsetHeight;
      }
    );

    const byRow = containers.reduce((acc, cur) => {
      (acc[Math.floor(cur.offsetTop)] ??= []).push(cur);
      return acc;
    }, {});

    const imgs = [];
    Object.values(byRow).forEach((row) => {
      const sortedByZ = row.sort(
        (a, b) => getComputedStyle(b).zIndex - getComputedStyle(a).zIndex
      );
      const top3 = sortedByZ.slice(0, 3);
      const sortedByLeft = top3.sort(
        (a, b) => a.offsetLeft - b.offsetLeft
      );
      sortedByLeft.forEach((el) => {
        if (el.firstElementChild) imgs.push(el.firstElementChild);
      });
    });

    return imgs;
  }

  function getCaptchaTarget() {
    try {
      if (typeof $ === "function") {
        const labels = $(".box-label").get();
        if (labels.length) {
          const top = labels.sort(
            (a, b) => getComputedStyle(b).zIndex - getComputedStyle(a).zIndex
          )[0];
          return (top.textContent || "").replace(/\D+/g, "").trim();
        }
      }
    } catch (e) {}

    const lbls = Array.from(document.querySelectorAll(".box-label"));
    if (!lbls.length) return "";
    const top = lbls[0];
    return (top.textContent || "").replace(/\D+/g, "").trim();
  }

  function getSelectedTokens() {
    const imgs = document.querySelectorAll(".captcha-img.img-selected");
    const tokens = [];
    imgs.forEach((img) => {
      const on = img.getAttribute("onclick") || "";
      const m  = on.match(/Select\('([^']+)'/);
      if (m && m[1]) tokens.push(m[1]);
    });
    return tokens;
  }

  function buildSelectedImagesValue() {
    const tokens = getSelectedTokens();
    return tokens.join(",");
  }

  // ===================== delay + apiKey =====================

  function loadDelayMs() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve(0);
          return;
        }
      } catch {
        resolve(0);
        return;
      }

      chrome.storage.local.get(
        ["calendria_use_delays", "calendria_delay_apptcaptcha"],
        (res = {}) => {
          const master = (res.calendria_use_delays || "off") === "on";
          if (!master) return resolve(0);

          let raw = (res.calendria_delay_apptcaptcha || "")
            .toString()
            .trim()
            .replace(",", ".");
          let sec = parseFloat(raw);
          if (!isFinite(sec) || sec < 0) sec = 0;
          resolve(Math.round(sec * 1000));
        }
      );
    });
  }

  function loadNoCaptchaApiKey() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          const raw =
            window.__SAMURAI_STORAGE &&
            window.__SAMURAI_STORAGE.calendria_nocaptcha_apikey;
          resolve(String(raw || "").trim());
          return;
        }
      } catch {
        resolve("");
        return;
      }
      chrome.storage.local.get("calendria_nocaptcha_apikey", (res = {}) => {
        resolve(String(res.calendria_nocaptcha_apikey || "").trim());
      });
    });
  }

  // ===================== ready check =====================

  function isReadyForSubmit() {
    const tokenVal   = getTokenValue();
    const dataVal    = getDataValue();
    const clientVal  = getClientDataValue();
    const selTokens  = getSelectedTokens();

    if (!tokenVal)
      return { ok: false, reason: "missing __RequestVerificationToken" };
    if (!dataVal)
      return { ok: false, reason: "missing Data" };
    if (!clientVal)
      return { ok: false, reason: "missing ClientData" };

    if (selTokens.length <= 0)
      return { ok: false, reason: "no selected images" };

    return { ok: true, reason: "" };
  }

  // ===================== main submit via fetch =====================

  let __sent = false;

  async function submitViaFetch() {
    const form = getForm();
    if (!form) {
      warn("form not found");
      return;
    }

    const ready = isReadyForSubmit();
    if (!ready.ok) {
      warn("[AC] Not ready for submit:", ready.reason);
      return;
    }

    if (__sent) {
      warn("submitViaFetch called twice, skipping");
      return;
    }
    __sent = true;

    const tokenVal          = getTokenValue();
    const dataVal           = getDataValue();
    const clientVal         = getClientDataValue();
    const selectedImagesVal = buildSelectedImagesValue();
    const extras            = getExtraInputs();

    const params = new URLSearchParams();

    function appendField(name, value) {
      params.append(name, value == null ? "" : String(value));
    }

    // نفس الترتيب اللي طلبتيه
    appendField("__RequestVerificationToken", tokenVal);
    appendField("SelectedImages", selectedImagesVal);
    appendField("Data", dataVal);
    appendField("ClientData", clientVal);
    extras.forEach((f) => appendField(f.name, f.value));

    log("[AC] POST payload preview:", Object.fromEntries(params.entries()));

    const delayMs = await loadDelayMs();
    if (delayMs > 0) {
      log(`[AC] waiting ${delayMs} ms before POST ...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const actionAttr =
      form.getAttribute("action") || "/MAR/Appointment/appointmentcaptcha";
    const url = actionAttr.startsWith("http")
      ? actionAttr
      : location.origin + actionAttr;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        credentials: "same-origin",
        redirect: "follow"           // ⬅️ نخلي المتصفح يتبع 302 لكن بدون تغيير الصفحة
      });

      const finalUrl = (resp.url || "").toLowerCase();
      log("[AC] fetch completed, final URL =", resp.url, "status =", resp.status);

      if (finalUrl.includes("/MAR/Appointment/VisaType")) {
        // ✅ نجاح: الرد النهائي VisaType → ندخل لها
        log("[AC] final URL is VisaType → navigating:", resp.url);
        window.location.href = resp.url;
      } else {
        // ❌ أي صفحة أخرى → نبقى هنا و نرسل فقط fetch NewAppointment
        log("[AC] final URL is NOT VisaType → staying on page & ping NewAppointment");
        fetch("/MAR/appointment/newappointment", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-cache"
        })
          .then(r => log("[AC] extra NewAppointment fetch status =", r.status))
          .catch(e => console.warn(LOG, "extra NewAppointment fetch error:", e));
      }
    } catch (err) {
      __sent = false;
      console.error(LOG, "submitViaFetch error:", err);
    }
  }

  // ===================== NoCaptchaAI solving =====================

  async function autoSolveCaptchaIfPossible() {
    if (typeof $ === "undefined" || !$ || !$.post) {
      warn("jQuery غير موجود، NoCaptchaAI لن يعمل");
      return;
    }

    const apiKey = await loadNoCaptchaApiKey();
    if (!apiKey) {
      log("NoCaptchaAI apiKey فارغ → لن نحل الكابتشا");
      return;
    }

    const target = getCaptchaTarget();
    const grid   = getCaptchaGrid();

    if (!target || !grid || !grid.length) {
      warn("target أو grid غير متوفرين، تخطي NoCaptchaAI");
      return;
    }

    const imagesPayload = Object.fromEntries(
      grid.map((img) => img.src).entries()
    );

    log("Calling NoCaptchaAI, target =", target, "grid length =", grid.length);

    $.post({
      url: "https://pro.nocaptchaai.com/solve",
      headers: { apiKey },
      contentType: "application/json",
      dataType: "json",
      data: JSON.stringify({
        method: "ocr",
        id: "morocco",          // نفس ID المستعمل ف LoginCaptcha
        images: imagesPayload
      }),
      timeout: 30000,
      beforeSend() {
        log("Solving appointment captcha via NoCaptchaAI ...");
      },
      complete(xhr, state) {
        log("NoCaptchaAI complete:", state);
        if (state !== "success") {
          console.warn(LOG, "NoCaptchaAI error:", state, xhr);
          return;
        }

        const result = xhr.responseJSON || {};
        if (result.status !== "solved") {
          console.warn(LOG, "NoCaptchaAI status !solved:", result);
          return;
        }

        try {
          Object.entries(result.solution || {}).forEach(([index, value]) => {
            if (String(value) === String(target)) {
              const idx = Number(index);
              if (!Number.isNaN(idx) && grid[idx]) {
                grid[idx].click();
              }
            }
          });

          submitViaFetch();
        } catch (e) {
          console.error(LOG, "Error in success handler:", e);
        }
      }
    });
  }

  // ===================== setup =====================

  function setup() {
    const form = getForm();
    if (!form) {
      warn("AppointmentCaptcha form NOT found");
      return;
    }

    // إذا المستخدم ضغط submit يدويًا، نستعمل نفس منطقنا (بدون form.submit)
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      submitViaFetch();
    });

    autoSolveCaptchaIfPossible().catch((e) =>
      console.error(LOG, "autoSolveCaptchaIfPossible error:", e)
    );

    log("AppointmentCaptcha handler ready (fetch + final URL check)");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(setup, 200);
  } else {
    document.addEventListener("DOMContentLoaded", () =>
      setTimeout(setup, 200)
    );
  }
})();
