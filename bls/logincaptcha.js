
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

  // نجيب الباسوورد من storage snapshot ديال الإضافة
  function getStoredPassword() {
    try {
      const raw =
        (window.__SAMURAI_STORAGE &&
          window.__SAMURAI_STORAGE.calendria_captcha_code) ||
        "";
      const pwd = String(raw || "").trim();
      if (!pwd) log("No calendria_captcha_code in storage");
      else log("Loaded calendria_captcha_code from storage");
      return pwd;
    } catch {
      warn("Failed reading calendria_captcha_code from __SAMURAI_STORAGE");
      return "";
    }
  }

  // نحدد فقط الانبوت الأصلي ديال الباسوورد (اللي كيبان ف الصفحة)
  function getPrimaryPasswordInput() {
    // نحاول نلقاه عن طريق الـ label[for] (حتى لو النص مشفّر)
    const labels = Array.from(document.querySelectorAll("label[for]"));
    let inp = null;

    // إذا كان عندنا label مربوط input مرئي
    for (const lb of labels) {
      const id = lb.getAttribute("for");
      if (!id) continue;
      const el = document.getElementById(id);
      if (
        el &&
        el.type === "password" &&
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        el.getClientRects().length > 0
      ) {
        inp = el;
        break;
      }
    }

    if (inp) return inp;

    // fallback: أول input[type=password] ظاهر للمستخدم
    const all = Array.from(
      document.querySelectorAll('input[type="password"]')
    );
    const visible = all.find(
      (el) =>
        el.offsetWidth > 0 &&
        el.offsetHeight > 0 &&
        el.getClientRects().length > 0
    );
    return visible || null;
  }

  // تعمير الانبوت الأصلي فقط من calendria_captcha_code
  function prefillPrimaryPasswordFromStorage() {
    const pwd = getStoredPassword();
    if (!pwd) return;

    const inp = getPrimaryPasswordInput();
    if (!inp) {
      warn("primary password input not found");
      return;
    }

    if (!inp.value) {
      inp.value = pwd;
      try {
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
      log("Primary password input filled from storage (id=" + inp.id + ")");
    } else {
      log("Primary password input already has value, not overwriting");
    }
  }

  // نقرأ فقط القيم الحالية لكل خانات الباسوورد (الموقع هو اللي يعمرهم)
  function getPasswordFields() {
    const inputs = Array.from(
      document.querySelectorAll('input[type="password"][id]')
    );
    const fields = inputs.slice(0, 10).map((inp) => ({
      id: inp.id,
      name: inp.name || inp.id,
      value: inp.value || ""
    }));
    log("Found password fields:", fields.map(f => f.id));
    return fields;
  }

  // grid ديال الصور (3x3) نفس منطق logen jdidi
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

  function getCaptchaTarget() {
    try {
      if (typeof $ === "function") {
        const labels = $(".box-label").get();
        if (labels.length) {
          const top = labels
            .sort(
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

  // ✅ دابا ما بقيناش نطالبو كل الحقول تكون معمرة، غير واحد يكفي
  function isReadyForSubmit(pwdFields) {
    const pwd = getStoredPassword();
    if (!pwd) {
      return { ok: false, reason: "no stored password calendria_captcha_code" };
    }
    if (!pwdFields || !pwdFields.length) {
      return { ok: false, reason: "no password inputs found" };
    }

    const hasAnyFilled = pwdFields.some((f) =>
      String(f.value || "").trim()
    );
    if (!hasAnyFilled) {
      return { ok: false, reason: "no password field filled" };
    }

    const tokens = getSelectedTokens();
    if (tokens.length <= 3) {
      return { ok: false, reason: "not enough selected images" };
    }
    return { ok: true, reason: "" };
  }

  // =============== POST custom ===============
  let __sent = false;

    // =============== POST custom ===============
    let __sent = false;
  
    function buildAndSubmit(form, pwdFields) {
      if (__sent) {
        warn("buildAndSubmit called twice, skipping");
        return;
      }
      __sent = true;
  
      pwdFields = pwdFields || getPasswordFields();
  
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
  
      const actionAttr =
        form.getAttribute("action") || "/MAR/NewCaptcha/LoginCaptchaSubmit";
      const actionUrl = actionAttr.startsWith("http")
        ? actionAttr
        : location.origin + actionAttr;
  
      // ⬅️ نبني body بنفس الترتيب باستعمال URLSearchParams
      const params = new URLSearchParams();
  
      function appendField(name, value) {
        params.append(name, value == null ? "" : String(value));
      }
  
      // 1) جميع حقول الباسوورد (حتى لو بعضهم فارغ)
      pwdFields.forEach((f) => {
        fieldNames.push(f.name);
        responseData[f.name] = f.value;
        appendField(f.name, f.value);
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
  
      log("Custom fetch POST →", actionUrl);
      log("Custom payload fields:", fieldNames);
  
      // ⬅️ نرسل POST عن طريق fetch بلا تنقل
      fetch(actionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString(),
        credentials: "same-origin",
        redirect: "manual" // مايتبعش 302
      })
        .then((resp) => {
          log("LoginCaptchaSubmit fetch status:", resp.status);
          // مباشرة نمشيو لصفحة NewAppointment
          const targetUrl =
            "https://www.blsspainmorocco.net/MAR/appointment/newappointment";
          log("Redirecting manually to:", targetUrl);
          window.location.href = targetUrl;
        })
        .catch((err) => {
          __sent = false; // في حالة الخطأ نسمحو بمحاولة ثانية
          console.error(LOG, "fetch LoginCaptchaSubmit error:", err);
        });
    }


  async function doCustomSubmitIfReady() {
    const form = getForm();
    if (!form) {
      warn("form not found in doCustomSubmitIfReady");
      return;
    }
    const pwdFields = getPasswordFields(); // الموقع هو اللي عامرهم بناءً على الانبوت الأصلي
    const ready = isReadyForSubmit(pwdFields);
    if (!ready.ok) {
      warn("[LC] Not ready for submit:", ready.reason);
      return;
    }
    const delayMs = await loadDelayMs();
    if (delayMs > 0) {
      log(`[LC] ready → waiting ${delayMs} ms before POST`);
      setTimeout(() => buildAndSubmit(form, pwdFields), delayMs);
    } else {
      buildAndSubmit(form, pwdFields);
    }
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
          // نختار الصور المطابقة للهدف
          Object.entries(result.solution || {}).forEach(([index, value]) => {
            if (String(value) === String(target)) {
              const idx = Number(index);
              if (!Number.isNaN(idx) && grid[idx]) {
                grid[idx].click();
              }
            }
          });

          // من بعد الحل + select، نجرب نرسل POST ديالنا
          doCustomSubmitIfReady();
        } catch (e) {
          console.error(LOG, "Error in success handler:", e);
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

    // intercept submit اليدوي (لو ضغطت Submit)
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      doCustomSubmitIfReady();
    });

    // نعمر فقط الانبوت الأصلي من storage
    prefillPrimaryPasswordFromStorage();

    // نطلق حل الكابتشا مباشرة
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
