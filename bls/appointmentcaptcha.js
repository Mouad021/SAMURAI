// == CALENDRIA AppointmentCaptcha helper (NoCaptchaAI + form.submit) ==
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

  // نجمع باقي ال hidden inputs (فقط باش نعاينهم فالـ log)
  function getExtraInputsPreview() {
    const extras = {};
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
        extras[name] = inp.value || "";
      });
    return extras;
  }

  // ===================== helpers: captcha grid & target =====================

  function getCaptchaGrid() {
    // نفس منطق logincaptcha: jQuery إذا كان، وإلا DOM عادي
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
    } catch (e) {}

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

  function ensureSelectedImagesInput(form, value) {
    let inp = form.querySelector('input[name="SelectedImages"]');
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = "SelectedImages";
      form.appendChild(inp);
    }
    inp.value = value || "";
  }

  // ===================== helpers: delay + NoCaptchaAI =====================

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
          try {
            const raw =
              window.__SAMURAI_STORAGE &&
              window.__SAMURAI_STORAGE.calendria_nocaptcha_apikey;
            resolve(String(raw || "").trim());
            return;
          } catch {
            resolve("");
            return;
          }
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
      return { ok: false, reason: "not enough selected images" };

    return { ok: true, reason: "" };
  }

  // ===================== form submit =====================

  let __sent = false;

  async function buildAndSubmit() {
    if (__sent) {
      warn("buildAndSubmit called twice, skipping");
      return;
    }

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

    // نبني SelectedImages من DOM ونحقنو في الفورم
    const selectedImagesVal = buildSelectedImagesValue();
    ensureSelectedImagesInput(form, selectedImagesVal);

    // log preview فقط للمراقبة
    const payloadPreview = {
      __RequestVerificationToken: getTokenValue(),
      SelectedImages: selectedImagesVal,
      Data: getDataValue(),
      ClientData: getClientDataValue(),
      ...getExtraInputsPreview()
    };
    log("[AC] FORM PAYLOAD PREVIEW (order server-side):", payloadPreview);

    const delayMs = await loadDelayMs();
    if (delayMs > 0) {
      log(`[AC] waiting ${delayMs} ms before form.submit() ...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    __sent = true;
    try {
      form.submit(); // ⬅️ هنا المتصفح يتكلف بـ POST + 302 + redirect طبيعي
      log("[AC] form.submit() called");
    } catch (e) {
      __sent = false;
      console.error(LOG, "form.submit error:", e);
    }
  }

  async function doCustomSubmitIfReady() {
    const ready = isReadyForSubmit();
    if (!ready.ok) {
      warn("[AC] Not ready for submit:", ready.reason);
      return;
    }
    await buildAndSubmit();
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
        id: "morocco-appt",
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

          // بعد ما نختار الصور، نرسل الفورم بالطريقة العادية
          doCustomSubmitIfReady();
        } catch (e) {
          console.error(LOG, "Error in success handler:", e);
        }
      }
    });
  }

  // ===================== setup =====================

  function setup() {
    const form = getForm();
    if (form) {
      // إلى حاول المستخدم يضغط Submit يدوي، نستغل نفس المنطق
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        doCustomSubmitIfReady();
      });
    } else {
      warn("AppointmentCaptcha form NOT found");
    }

    autoSolveCaptchaIfPossible().catch((e) =>
      console.error(LOG, "autoSolveCaptchaIfPossible error:", e)
    );

    log("AppointmentCaptcha custom handler ready (form.submit navigation)");
  }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(setup, 200);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(setup, 200));
  }
})();
