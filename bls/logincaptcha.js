// == CALENDRIA – NewCaptcha/LoginCaptcha
//  • حل الكابتشا بـ NoCaptchaAI (نفس منطق logen jdidi)
//  • اختيار الصور المطابقة للـ target أوتوماتيكياً
//  • intercept للـ submit + delay + POST بفورم مخفي وترتيب payload
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

  // =============== helpers عامة ===============

  function getForm() {
    return (
      document.querySelector('form[action*="logincaptchasubmit"]') ||
      document.querySelector("form")
    );
  }

  // نفس #getCaptchaGrid القديم
  function getCaptchaGrid() {
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

    // fallback بدون jQuery (تقريباً نفس الفكرة)
    const containers = Array.from(document.querySelectorAll("*")).filter((el) => {
      const c = el.firstElementChild;
      if (!c) return false;
      if (!c.classList || !c.classList.contains("captcha-img")) return false;
      const r = el.getClientRects();
      return r && r.length && el.offsetWidth && el.offsetHeight;
    });

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

  // نفس #getCaptchaTarget القديم
  function getCaptchaTarget() {
    const labels = $(".box-label").get();
    if (!labels.length) return "";
    const top = labels
      .sort((a, b) => getComputedStyle(b).zIndex - getComputedStyle(a).zIndex)[0];
    return (top.textContent || "")
      .replace(/\D+/, "") // ناخدو الجزء الرقمي
      .trim();
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
          if (!master) return resolve(0);

          let raw = (res.calendria_delay_logincaptcha || "")
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
          resolve("");
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
      if (out.length) return out;
    }
    return [];
  }

  function isReadyForSubmit(form, spec) {
    spec = spec || parseSubmittedDataSpec();
    if (!spec.length) return { ok: false, reason: "no spec" };
    const pwdSpec = spec.slice(0, 10);

    for (const { id } of pwdSpec) {
      const inp = document.getElementById(id);
      const v = inp ? String(inp.value || "").trim() : "";
      if (!v) return { ok: false, reason: "password fields not all filled" };
    }

    const tokens = getSelectedTokens();
    if (tokens.length <= 3) {
      return { ok: false, reason: "not enough selected images" };
    }

    return { ok: true, reason: "" };
  }

  // =============== POST custom ===============
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

    // 5) ResponseData JSON
    appendField("ResponseData", JSON.stringify(responseData));

    // 6) Param
    appendField("Param", paramVal);

    // 7) CaptchaText
    appendField("CaptchaText", captchaText);

    // 8) التوكن في الأخير
    if (tokenVal) appendField("__RequestVerificationToken", tokenVal);

    log("Custom form action:", actionUrl);
    document.body.appendChild(tmpForm);
    tmpForm.submit();
  }

  // =============== حل الكابتشا بـ NoCaptchaAI ===============
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
      warn("target أو grid غير متوفرين، تخطّي NoCaptchaAI");
      return;
    }

    const imagesPayload = Object.fromEntries(
      grid.map((img) => img.src).entries()
    );

    log("Calling NoCaptchaAI, target =", target, "grid length =", grid.length);

    const onError = (type, data) => {
      console.error(LOG, "NoCaptchaAI error:", type, data);
      $(".validation-summary-valid").html("<b>Failed to solve captcha.</b>");
    };

    const onSuccess = (result) => {
      if (result.status === "solved") {
        try {
          Object.entries(result.solution || {}).forEach(([index, value]) => {
            if (String(value) === String(target)) {
              const idx = Number(index);
              if (!Number.isNaN(idx) && grid[idx]) {
                grid[idx].click(); // ✅ نفس منطق logen jdidi
              }
            }
          });

          // بعد اختيار الصور، نضغط Verify باش يدوز submit → intercept
          const btn = $("#btnVerify");
          if (btn.length) {
            setTimeout(() => btn.trigger("click"), 50);
          }
        } catch (e) {
          onError("handler", e);
        }
      } else {
        onError("captchaerror", result);
      }
    };

    $.post({
      url: "https://pro.nocaptchaai.com/solve",
      headers: { apiKey },
      contentType: "application/json",
      dataType: "json",
      data: JSON.stringify({
        method: "ocr",
        id: "morocco",
        images: imagesPayload,
      }),
      timeout: 30000,
      beforeSend() {
        log("Solving captcha via NoCaptchaAI ...");
      },
      complete(xhr, state) {
        log("NoCaptchaAI complete:", state);
        switch (state) {
          case "success":
            onSuccess(xhr.responseJSON);
            break;
          case "error":
          case "parsererror":
          default:
            onError(state, xhr);
            break;
        }
      },
    });
  }

  // =============== setup ===============
  function setup() {
    const form = getForm();
    if (!form) {
      warn("LoginCaptcha form NOT found");
      return;
    }

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      const spec  = parseSubmittedDataSpec();
      const ready = isReadyForSubmit(form, spec);
      if (!ready.ok) {
        warn("[LC] Not ready for submit:", ready.reason);
        return;
      }

      const delayMs = await loadDelayMs();
      if (delayMs > 0) {
        log(`[LC] ready → waiting ${delayMs} ms before POST`);
        setTimeout(() => buildAndSubmit(form, spec), delayMs);
      } else {
        buildAndSubmit(form, spec);
      }
    });

    // نطلق حل الكابتشا مباشرة عند دخول الصفحة
    autoSolveCaptchaIfPossible().catch((e) =>
      console.error(LOG, "autoSolveCaptchaIfPossible error:", e)
    );

    log("LoginCaptcha custom handler ready");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setup();
  } else {
    document.addEventListener("DOMContentLoaded", setup);
  }
})();
