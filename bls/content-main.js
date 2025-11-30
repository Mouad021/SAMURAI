// content-main.js — CALENDRIA LOGIN AUTO-POST (MAX SPEED + ALWAYS 10 FIELDS)

(function () {
  if (window.__calendria_injected) return;
  window.__calendria_injected = true;

  console.log(
    "%c[CALENDRIA] Content Script Injected",
    "color:#0ff;font-size:14px;"
  );

  function detectPageType() {
    const href = String(location.href || "").toLowerCase();

    const reSpecific =
      /https:\/\/www\.blsspainmorocco\.net\/mar\/account\/login\?returnurl=.*/i;

    const reGeneral =
      /https:\/\/www\.blsspainmorocco\.net\/mar\/account\/.*/i;

    if (reSpecific.test(href) || reGeneral.test(href)) {
      return "LOGIN";
    }

    return "OTHER";
  }

  const pageType = detectPageType();
  window.__calendria = {
    pageType,
    url: location.href,
    ts: Date.now()
  };
  console.log("[CALENDRIA] PAGE TYPE:", pageType, "URL:", location.href);

  function getLoginForm() {
    return (
      document.querySelector('form[action*="loginsubmit"]') ||
      document.querySelector("form")
    );
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.type === "hidden") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    if (el.offsetParent === null && style.position !== "fixed") return false;
    return true;
  }

  function findLoginEmailInput() {
    const form = getLoginForm();
    if (!form) return null;

    const labels = form.querySelectorAll("label");
    for (const label of labels) {
      const txt = (label.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (txt.includes("email")) {
        const forId = label.getAttribute("for");
        if (forId) {
          const input = document.getElementById(forId);
          if (input && input.tagName === "INPUT" && isVisible(input)) {
            console.log("[CALENDRIA] Email input via LABEL:", input);
            return input;
          }
        }
      }
    }

    const inputs = form.querySelectorAll("input");
    for (const input of inputs) {
      const t = (input.type || "").toLowerCase();
      if ((t === "text" || t === "email") && isVisible(input)) {
        console.log("[CALENDRIA] Email input via VISIBLE fallback:", input);
        return input;
      }
    }

    console.warn("[CALENDRIA] Email input NOT FOUND");
    return null;
  }

  function extractFieldNamesFromScriptsRaw() {
    const ids = [];
    const seenIds = new Set();

    const scripts = document.scripts;
    for (const s of scripts) {
      const code = s.textContent || "";
      if (!code || code.length < 20) continue;

      const re = /document\.getElementById\('([^']+)'\)/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        const id = m[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          ids.push(id);
        }
      }
    }

    const form = getLoginForm();
    if (!form) return [];

    const names = [];
    const seenNames = new Set();

    ids.forEach((id) => {
      const input = document.getElementById(id);
      if (!input || input.tagName !== "INPUT") return;
      const name = input.name;
      if (!name) return;
      if (seenNames.has(name)) return;
      seenNames.add(name);
      names.push(name);
    });

    console.log("[CALENDRIA] NAMES from scripts:", names);
    return names;
  }

  function getLoginFieldNames() {
    const form = getLoginForm();
    if (!form) {
      console.warn("[CALENDRIA] getLoginFieldNames: no form");
      return [];
    }

    const fromScripts = extractFieldNamesFromScriptsRaw();
    const merged = [...fromScripts];
    const seen = new Set(fromScripts);

    const skip = new Set([
      "__RequestVerificationToken",
      "ReturnUrl",
      "Id",
      "ResponseData"
    ]);

    const inputs = form.querySelectorAll("input[name]");
    inputs.forEach((inp) => {
      const name = inp.name;
      if (!name) return;
      if (skip.has(name)) return;
      if (seen.has(name)) return;
      seen.add(name);
      merged.push(name);
    });

    console.log("[CALENDRIA] MERGED field names (before trim):", merged);

    if (merged.length > 10) {
      const cut = merged.slice(0, 10);
      console.log("[CALENDRIA] Trimmed to first 10 names:", cut);
      return cut;
    }

    console.log("[CALENDRIA] FINAL field names (<=10):", merged);
    return merged;
  }

  function buildAndSubmitRealForm(email) {
    if (window.__calendria_loginDone) return;

    const form = getLoginForm();
    if (!form) {
      console.warn("[CALENDRIA] buildAndSubmitRealForm: no form");
      return;
    }

    const emailInput = findLoginEmailInput();
    if (!emailInput) {
      console.warn("[CALENDRIA] buildAndSubmitRealForm: no email input");
      return;
    }

    const fieldNames = getLoginFieldNames();
    if (!fieldNames.length) {
      console.warn("[CALENDRIA] buildAndSubmitRealForm: no field names");
      return;
    }

    if (fieldNames.length !== 10) {
      console.warn("[CALENDRIA] WARNING: fieldNames length != 10 →", fieldNames.length);
    }

    const emailFieldName = emailInput.name;
    if (!emailFieldName) {
      console.warn("[CALENDRIA] Email input has no name");
      return;
    }

    const returnUrlVal =
      form.querySelector('input[name="ReturnUrl"]')?.value || "";
    const idVal =
      form.querySelector('input[name="Id"]')?.value || "";
    const tokenVal =
      form.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const dataVal =
      form.querySelector('input[name="Data"]')?.value || ""; // ✅ Data الجديد

    // set email into real DOM input (in case server-side validation reads it)
    emailInput.value = email;

    // clear form children then rebuild with hidden fields
    while (form.firstChild) form.removeChild(form.firstChild);

    const responseData = {};

    fieldNames.forEach((name) => {
      const inp = document.createElement("input");
      inp.type = "hidden";
      inp.name = name;
      if (name === emailFieldName) {
        inp.value = email;
        responseData[name] = email;
      } else {
        inp.value = "";
        responseData[name] = "";
      }
      form.appendChild(inp);
    });

    const respInp = document.createElement("input");
    respInp.type = "hidden";
    respInp.name = "ResponseData";
    respInp.value = JSON.stringify(responseData);
    form.appendChild(respInp);

    const retInp = document.createElement("input");
    retInp.type = "hidden";
    retInp.name = "ReturnUrl";
    retInp.value = returnUrlVal;
    form.appendChild(retInp);

    const idInp = document.createElement("input");
    idInp.type = "hidden";
    idInp.name = "Id";
    idInp.value = idVal;
    form.appendChild(idInp);

    // ✅ حقل Data تحت Id مباشرة وبنفس القيمة التي كانت في الصفحة
    const dataInp = document.createElement("input");
    dataInp.type = "hidden";
    dataInp.name = "Data";
    dataInp.value = dataVal;
    form.appendChild(dataInp);

    const tokInp = document.createElement("input");
    tokInp.type = "hidden";
    tokInp.name = "__RequestVerificationToken";
    tokInp.value = tokenVal;
    form.appendChild(tokInp);

    console.log("[CALENDRIA] FINAL fieldNames:", fieldNames);
    console.log("[CALENDRIA] FINAL ResponseData:", responseData);
    console.log("[CALENDRIA] Data value:", dataVal);
    console.log("[CALENDRIA] SUBMITTING REAL FORM NOW");

    window.__calendria_loginDone = true;
    try {
      form.submit();
    } catch (e) {
      console.error("[CALENDRIA] form.submit() error:", e);
      window.__calendria_loginDone = false;
    }
  }

  function startFastAutoLogin(email) {
    let attempt = 0;
    const maxAttempts = 120; // 120 * 20ms = 2400ms

    const timer = setInterval(() => {
      attempt++;

      if (window.__calendria_loginDone) {
        clearInterval(timer);
        return;
      }

      const form = getLoginForm();
      const emailInput = findLoginEmailInput();
      const names = getLoginFieldNames();

      if (form && emailInput && names.length) {
        clearInterval(timer);
        buildAndSubmitRealForm(email);
        return;
      }

      if (attempt >= maxAttempts) {
        clearInterval(timer);
        console.warn("[CALENDRIA] Auto-login: timeout, conditions not ready.");
      }
    }, 20);
  }

  // =========================
  // LOGIN INIT + DELAY CONTROL
  // =========================
  const DEFAULT_LOGIN_DELAY_MS = 0; // الأصل: بدون تأخير (أقصى سرعة)

  if (pageType === "LOGIN") {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(
          ["calendria_email", "calendria_use_delays", "calendria_delay_login"],
          (res) => {
            const email = (res?.calendria_email || "").trim();
            console.log("[CALENDRIA] Saved email from storage:", email);
            if (!email) {
              console.warn("[CALENDRIA] No saved email, skip auto-login.");
              return;
            }

            const useDelays = (res?.calendria_use_delays || "off") === "on";
            let delayMs = DEFAULT_LOGIN_DELAY_MS;

            if (useDelays) {
              const raw = (res?.calendria_delay_login || "")
                .toString()
                .replace(",", ".");
              const n = parseFloat(raw);
              if (!isNaN(n) && n >= 0) {
                delayMs = Math.round(n * 1000);
              }
            }

            console.log("[CALENDRIA] Login delay config:", {
              useDelays,
              delayMs
            });

            if (delayMs > 0) {
              console.log(
                `[CALENDRIA] Auto-login scheduled after ${delayMs / 1000}s`
              );
              setTimeout(() => {
                startFastAutoLogin(email);
              }, delayMs);
            } else {
              // mode OFF أو قيمة غير صالحة → نفس السلوك القديم (بدون تأخير)
              startFastAutoLogin(email);
            }
          }
        );
      } else {
        console.warn("[CALENDRIA] chrome.storage.local not available.");
      }
    } catch (e) {
      console.error("[CALENDRIA] Error reading saved email:", e);
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;

      if (msg.type === "CALENDRIA_GET_STATUS") {
        sendResponse({
          ok: true,
          pageType: window.__calendria.pageType,
          url: window.__calendria.url,
          ts: window.__calendria.ts
        });
        return true;
      }
    });
  }
})();
