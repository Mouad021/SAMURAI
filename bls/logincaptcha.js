// == CALENDRIA – NewCaptcha/LoginCaptcha CUSTOM POST + NoCaptchaAI ==
//
// يعمل فقط في /MAR/NewCaptcha/LoginCaptcha
//
// 1) يمنع submit الأصلي و يبني POST يدوي:
//    - لا يرسل حتى:
//        * 10 خانات الباسوورد عامرين
//        * > 3 صور مختارة (img-selected)
//    - يستعمل Delay من popup (LoginCaptcha)
//    - يحترم ترتيب payload:
//        10 حقول الباسوورد → SelectedImages → Id → ReturnUrl
//        → ResponseData → Param → CaptchaText → __RequestVerificationToken
//    - يستعمل form مخفي + submit() → redirect طبيعي
//
// 2) منطق NoCaptchaAI مدموج:
//    - يقرأ apiKey من chrome.storage.local (calendria_nocaptcha_apikey)
//    - يجمع صور الكابتشا من الصفحة (أو يستعمل extractCaptchaGridData(grid) إذا كانت)
//    - يستدعي https://pro.nocaptchaai.com/solve بالـ OCR
//    - عند النجاح:
//        إذا كانت window.__CALENDRIA_ON_NOCAPTCHA_LOGINCAPTCHA_SUCCESS(fn)
//        يستدعيها و يمرر لها JSON ديال الرد
//      وإلا يطبع النتيجة في console فقط
//
(function () {
  "use strict";

  if (window.__calendria_logincaptcha_started) return;
  window.__calendria_logincaptcha_started = true;

  const LOG  = "[CALENDRIA][LoginCaptcha]";
  const log  = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  const href = (location.href || "").toLowerCase();
  if (!href.includes("/mar/newcaptcha/logincaptcha")) return;

  // =========================
  // 1) Helpers عامة
  // =========================
  function getForm() {
    return (
      document.querySelector('form[action*="logincaptchasubmit"]') ||
      document.querySelector("form")
    );
  }

  // submittedData spec
  function parseSubmittedDataSpec() {
    const scripts = Array.from(document.scripts || []);
    for (const s of scripts) {
      const txt = s.textContent || "";
      const idx = txt.indexOf("var submittedData=");
      if (idx === -1) continue;

      const sub = txt.slice(idx);
      const m = /var\s+submittedData\s*=\s*\{([\s\S]*?)\}\s*;/.exec(sub);
      if (!m || !m[1]) continue;

      const body = m[1];
      const re   = /([a-zA-Z0-9_]+)\s*:\s*\$\("#([^"]+)"\)\.val\(\)/g;

      const out = [];
      let mm;
      while ((mm = re.exec(body))) {
        out.push({ name: mm[1], id: mm[2] });
      }
      if (out.length) {
        log("submittedData spec len =", out.length, out);
        return out;
      }
    }
    warn("submittedData spec NOT found");
    return [];
  }

  // SelectedImages helpers
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
    const joined = tokens.join(",");
    log("SelectedImages tokens:", tokens, "→", joined);
    return joined;
  }

  // Delay من popup
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
        ["calendria_use_delays", "calendria_delay_logincaptcha"],
        (res = {}) => {
          const master = (res.calendria_use_delays || "off") === "on";
          if (!master) {
            log("[LC] delay master OFF → 0 ms");
            resolve(0);
            return;
          }
          let raw = (res.calendria_delay_logincaptcha || "")
            .toString()
            .trim()
            .replace(",", ".");
          let sec = parseFloat(raw);
          if (!isFinite(sec) || sec < 0) sec = 0;
          const ms = Math.round(sec * 1000);
          log("[LC] delay =", ms, "ms");
          resolve(ms);
        }
      );
    });
  }

  // قراءة apiKey ديال NoCaptchaAI من storage
  function loadNoCaptchaApiKey() {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.storage || !chrome.storage.local) {
          resolve("");
          return;
        }
      } catch {
        resolve("");
        return;
      }

      chrome.storage.local.get("calendria_nocaptcha_apikey", (res = {}) => {
        const raw = res.calendria_nocaptcha_apikey || "";
        resolve(String(raw || "").trim());
      });
    });
  }

  // =========================
  // 2) Ready check
  // =========================
  function isReadyForSubmit(form, spec) {
    if (!spec || !spec.length) spec = parseSubmittedDataSpec();
    if (!spec.length) return { ok: false, reason: "no spec" };

    const pwdSpec = spec.slice(0, 10);

    // كل 10 خانات لازم يكونو عامرين
    for (const { id } of pwdSpec) {
      const inp = document.getElementById(id);
      const v = inp ? String(inp.value || "").trim() : "";
      if (!v) {
        return { ok: false, reason: "password fields not all filled" };
      }
    }

    const tokens = getSelectedTokens();
    if (tokens.length <= 3) {
      return { ok: false, reason: "not enough selected images" };
    }

    return { ok: true, reason: "" };
  }

  // =========================
  // 3) بناء الفورم + submit
  // =========================
  let __sent = false;

  function buildAndSubmit(form, spec) {
    if (__sent) {
      warn("buildAndSubmit called twice, skipping");
      return;
    }
    __sent = true;

    spec = spec || parseSubmittedDataSpec();
    if (!spec.length) {
      warn("No submittedData spec → abort");
      return;
    }

    const pwdSpec = spec.slice(0, 10);

    const responseData = {};
    const fieldNames   = [];

    function getVal(selector) {
      const el = form.querySelector(selector);
      return el && el.value != null ? String(el.value) : "";
    }

    const idVal        = getVal('input[name="Id"]');
    const returnUrlVal = getVal('input[name="ReturnUrl"]');
    const paramVal     = getVal('input[name="Param"]');
    const captchaText  = getVal('input[name="CaptchaText"]');
    const tokenVal     = getVal('input[name="__RequestVerificationToken"]');

    const selectedImagesVal = buildSelectedImagesValue();

    const actionUrl =
      form.getAttribute("action") || "/MAR/NewCaptcha/LoginCaptchaSubmit";

    const tmpForm = document.createElement("form");
    tmpForm.method = "POST";
    tmpForm.action = actionUrl;
    tmpForm.style.display = "none";

    function appendField(name, value) {
      const inp = document.createElement("input");
      inp.type  = "hidden";
      inp.name  = name;
      inp.value = value;
      tmpForm.appendChild(inp);
    }

    // 1) 10 الحقول بالترتيب
    pwdSpec.forEach(({ name, id }) => {
      const inp = document.getElementById(id);
      const val = inp ? String(inp.value || "") : "";
      fieldNames.push(name);
      responseData[name] = val;
      appendField(name, val);
    });

    // 2) SelectedImages
    appendField("SelectedImages", selectedImagesVal);

    // 3) Id
    appendField("Id", idVal);

    // 4) ReturnUrl
    appendField("ReturnUrl", returnUrlVal);

    // 5) ResponseData (JSON)
    appendField("ResponseData", JSON.stringify(responseData));

    // 6) Param
    appendField("Param", paramVal);

    // 7) CaptchaText
    appendField("CaptchaText", captchaText);

    // 8) __RequestVerificationToken (في الأخير)
    if (tokenVal) {
      appendField("__RequestVerificationToken", tokenVal);
    }

    log("fieldNames (10 pwd):", fieldNames);
    log("ResponseData object:", responseData);
    log("Custom form action:", actionUrl);
    log("Custom form built → submitting now");

    document.body.appendChild(tmpForm);
    tmpForm.submit(); // المتصفح يتبع redirect طبيعي
  }

  // =========================
  // 4) منطق NoCaptchaAI (حل الكابتشا)
  // =========================
  async function autoSolveCaptchaIfPossible() {
    if (typeof $ === "undefined" || !$ || !$.post) {
      warn("jQuery $.post غير متوفر، NoCaptchaAI لن يعمل");
      return;
    }

    const apiKey = await loadNoCaptchaApiKey();
    if (!apiKey) {
      log("NoCaptchaAI apiKey فارغ → تخطّي");
      return;
    }

    let gridData = null;

    try {
      // إذا كان عندك function جاهزة في الصفحة
      if (typeof extractCaptchaGridData === "function" && window.grid) {
        gridData = extractCaptchaGridData(window.grid);
      } else {
        // fallback: نأخذ src ديال كل .captcha-img
        const imgs = Array.from(document.querySelectorAll(".captcha-img"));
        if (!imgs.length) {
          warn("لم أجد .captcha-img في الصفحة، لا يمكن بناء gridData");
          return;
        }
        gridData = imgs.map((img) => img.src);
      }
    } catch (e) {
      console.error(LOG, "Error while building gridData:", e);
      return;
    }

    if (!gridData || !gridData.length) {
      warn("gridData فارغ، NoCaptchaAI لن يُستدعى");
      return;
    }

    log("Calling NoCaptchaAI OCR, images.length =", gridData.length);

    $.post({
      url: "https://pro.nocaptchaai.com/solve",
      headers: { apiKey },
      contentType: "application/json",
      dataType: "json",
      data: JSON.stringify({
        method: "ocr",
        id: "morocco",
        images: gridData,
      }),
      timeout: 30000,
      beforeSend() {
        log("Solving captcha via NoCaptchaAI ...");
      },
      complete(xhr, state) {
        log("NoCaptchaAI complete:", state);
        if (state === "success") {
          const json = xhr.responseJSON;
          try {
            if (
              typeof window.__CALENDRIA_ON_NOCAPTCHA_LOGINCAPTCHA_SUCCESS ===
              "function"
            ) {
              window.__CALENDRIA_ON_NOCAPTCHA_LOGINCAPTCHA_SUCCESS(json);
            } else {
              console.log(LOG, "NoCaptchaAI success JSON:", json);
              console.log(
                LOG,
                "⚠️ عرّف window.__CALENDRIA_ON_NOCAPTCHA_LOGINCAPTCHA_SUCCESS(json) لاستعمال النتيجة (تعمير باسوورد / اختيار صور...)"
              );
            }
          } catch (e) {
            console.error(LOG, "Error in success handler:", e);
          }
        } else {
          console.warn(LOG, "NoCaptchaAI error:", state, xhr);
        }
      },
    });
  }

  // =========================
  // 5) setup
  // =========================
  function setup() {
    const form = getForm();
    if (!form) {
      warn("LoginCaptcha form NOT found");
      return;
    }

    // اعتراض submit
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      const spec = parseSubmittedDataSpec();
      const ready = isReadyForSubmit(form, spec);
      if (!ready.ok) {
        warn("[LC] Not ready for submit:", ready.reason);
        return;
      }

      const delayMs = await loadDelayMs();
      if (delayMs > 0) {
        log(`[LC] Everything ready → waiting ${delayMs} ms before POST`);
        setTimeout(() => buildAndSubmit(form, spec), delayMs);
      } else {
        log("[LC] Everything ready → sending immediately");
        buildAndSubmit(form, spec);
      }
    });

    // نطلق NoCaptchaAI أوتوماتيكياً مرّة واحدة
    autoSolveCaptchaIfPossible().catch((e) =>
      console.error(LOG, "autoSolveCaptchaIfPossible error:", e)
    );

    log("LoginCaptcha custom POST + NoCaptchaAI handler ready");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setup();
  } else {
    document.addEventListener("DOMContentLoaded", setup);
  }
})();
