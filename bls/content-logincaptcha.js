(function () {
  "use strict";

  const href = location.href.toLowerCase();
  if (!href.includes("/mar/newcaptcha/logincaptcha")) return;

  if (window.__calendria_loginCaptcha_injected) return;
  window.__calendria_loginCaptcha_injected = true;

  console.log(
    "%c[CALENDRIA] LoginCaptcha Script Injected (FETCH + PASSWORD + AW8/NCAI)",
    "color:#0ff;font-size:14px;"
  );

  // ==============================
  // CAPTCHA MODE (AW8 / NoCaptchaAI)
  // ==============================
  let __cal_captcha_mode = "aw8";       // "aw8" | "nocaptchaai"
  let __cal_captcha_apikey = "";        // NoCaptchaAI apiKey
  let __captcha_settings_loaded = false;
  let __dom_ready = false;

  function startSolversAccordingToMode() {
    if (!__captcha_settings_loaded || !__dom_ready) return;

    console.log(
      "[CALENDRIA][LoginCaptcha] startSolversAccordingToMode -> mode=",
      __cal_captcha_mode
    );

    if (__cal_captcha_mode === "nocaptchaai") {
      initNoCaptchaLoginIfEnabled();
      return;
    }

    if (__cal_captcha_mode === "aw8") {
      initAw8LoginCaptcha();
      return;
    }

    // fallback الافتراضي: نخلي AW8
    initAw8LoginCaptcha();
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(
        ["cal_captcha_mode", "cal_captcha_apikey"],
        (res = {}) => {
          __cal_captcha_mode = res.cal_captcha_mode || "aw8";
          __cal_captcha_apikey = res.cal_captcha_apikey || "";
          console.log(
            "[CALENDRIA][CAPTCHA] mode =",
            __cal_captcha_mode,
            "apiKey.len=",
            __cal_captcha_apikey.length
          );
          __captcha_settings_loaded = true;
          startSolversAccordingToMode();
        }
      );
    }
  } catch (e) {
    console.warn("[CALENDRIA][CAPTCHA] failed to read captcha mode/apikey:", e);
    __captcha_settings_loaded = true;
  }

  // ==============================
  // DELAY CONFIG (LoginCaptcha)
  // ==============================
  let LC_USE_DELAY_CONFIG = false;
  let LOGIN_CAPTCHA_DELAY_MS = 0;

  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    ) {
      chrome.storage.local.get(
        ["calendria_use_delays", "calendria_delay_logincaptcha"],
        (res = {}) => {
          LC_USE_DELAY_CONFIG = (res.calendria_use_delays || "off") === "on";
          const raw = (res.calendria_delay_logincaptcha || "")
            .toString()
            .replace(",", ".");
          const n = parseFloat(raw);
          LOGIN_CAPTCHA_DELAY_MS =
            !isNaN(n) && n >= 0 ? Math.round(n * 1000) : 0;

          console.log("[CALENDRIA][LoginCaptcha] Delay config:", {
            LC_USE_DELAY_CONFIG,
            LOGIN_CAPTCHA_DELAY_MS,
          });
        }
      );
    }
  } catch (e) {
    console.warn("[CALENDRIA][LoginCaptcha] delay config error:", e);
  }

  function getCaptchaForm() {
    return (
      document.querySelector('form[action*="logincaptchasubmit"]') ||
      document.querySelector("form#captchaForm") ||
      document.querySelector("form")
    );
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    if (el.offsetParent === null && style.position !== "fixed") return false;
    return true;
  }

  function findRealVisiblePasswordInput() {
    const candidates = Array.from(
      document.querySelectorAll('input.entry-disabled[type="password"]')
    );
    const visible = candidates.filter(isVisible);
    if (visible.length) {
      return visible[0];
    }
    return null;
  }

  function loadStoredCode(callback) {
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        console.warn("[CALENDRIA][CAPTCHA] chrome.storage.local not available");
        callback("");
        return;
      }
      chrome.storage.local.get(["calendria_captcha_code"], (res) => {
        const code = (res?.calendria_captcha_code || "").trim();
        console.log("[CALENDRIA][CAPTCHA] loaded code from storage:", code);
        callback(code);
      });
    } catch (e) {
      console.error("[CALENDRIA][CAPTCHA] loadStoredCode error:", e);
      callback("");
    }
  }

  function applyPasswordOnce(passwordValue) {
    if (!passwordValue) return false;
    const inp = findRealVisiblePasswordInput();
    if (!inp) return false;

    if (inp.value !== passwordValue) {
      inp.value = passwordValue;

      try {
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}

      console.log("[CALENDRIA][CAPTCHA] Password applied to REAL visible input.");
    }
    return true;
  }

  function startPasswordGuardian(passwordValue) {
    if (!passwordValue) {
      console.warn("[CALENDRIA][CAPTCHA] No password in storage.");
      return;
    }

    let ticks = 0;
    const maxTicks = 5 * 60 * (1000 / 150);

    const timer = setInterval(() => {
      ticks++;
      applyPasswordOnce(passwordValue);

      if (ticks > maxTicks) {
        clearInterval(timer);
        console.warn("[CALENDRIA][CAPTCHA] stop password guardian (timeout).");
      }
    }, 150);

    const obs = new MutationObserver(() => {
      applyPasswordOnce(passwordValue);
    });

    obs.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    window.__calendria_pwdObs = obs;
  }

  function extractIdsFromSubmittedDataBlock() {
    const scripts = document.scripts;
    for (const s of scripts) {
      const code = s.textContent || "";
      const idx = code.indexOf("var submittedData");
      if (idx === -1) continue;

      const part = code.slice(idx, idx + 2500);
      const blockMatch = part.match(/var\s+submittedData\s*=\s*{([\s\S]*?)};/);
      if (!blockMatch) continue;

      const block = blockMatch[1];
      const ids = [];
      const re = /:\s*\$\("#([a-z0-9]+)"\)\.val\(\)/gi;
      let m;
      while ((m = re.exec(block)) !== null) {
        ids.push(m[1]);
      }

      if (ids.length) {
        const uniq = [];
        ids.forEach((id) => !uniq.includes(id) && uniq.push(id));
        console.log("[CALENDRIA][CAPTCHA] IDs from submittedData block:", uniq);
        return uniq;
      }
    }
    console.warn("[CALENDRIA][CAPTCHA] No submittedData block found.");
    return [];
  }

  function fallbackFieldIdsFromInputs() {
    const form = getCaptchaForm();
    if (!form) return [];

    const candidates = Array.from(
      form.querySelectorAll(
        "input.entry-disabled[type='text'],input.entry-disabled[type='password']"
      )
    ).filter(isVisible);

    const ids = [];
    for (const inp of candidates) {
      if (ids.length >= 10) break;
      if (inp.id) ids.push(inp.id);
    }

    console.log("[CALENDRIA][CAPTCHA] Fallback IDs from inputs:", ids);
    return ids;
  }

  function extractFieldNamesOrdered() {
    const form = getCaptchaForm();
    if (!form) return [];

    let ids = extractIdsFromSubmittedDataBlock();
    if (!ids.length) ids = fallbackFieldIdsFromInputs();

    const names = [];
    ids.forEach((id) => {
      const inp = document.getElementById(id);
      const name = inp?.name || id;
      names.push({ id, name });
    });

    console.log("[CALENDRIA][CAPTCHA] ordered id→name list:", names);
    return names;
  }

  function getSelectedImageCodes() {
    const selectedImgs = Array.from(
      document.querySelectorAll(".captcha-img.img-selected")
    );

    return selectedImgs
      .map((img) => {
        const attr = img.getAttribute("onclick") || "";
        const m = attr.match(/Select\('([^']+)'/i);
        return m ? m[1] : null;
      })
      .filter(Boolean);
  }

  function buildResponseData(idNameList) {
    const form = getCaptchaForm();
    const responseData = {};

    idNameList.forEach(({ id, name }, idx) => {
      const byId = document.getElementById(id);
      const byName =
        form && name
          ? form.querySelector(`input[name="${CSS.escape(name)}"]`)
          : null;
      const inp = byId || byName;
      responseData[name || "f" + idx] = inp?.value || "";
    });

    return responseData;
  }

  // =====================================================
  //  إرسال LoginCaptcha عبر FETCH
  // =====================================================
  async function sendLoginCaptchaFetch(passwordValue) {
    console.log("[CALENDRIA][CAPTCHA] sendLoginCaptchaFetch START");

    const form = getCaptchaForm();
    if (!form) return;

    const codes = getSelectedImageCodes();
    if (!codes.length) {
      console.warn("[CALENDRIA][CAPTCHA] No selected images, abort fetch.");
      return;
    }
    const selectedStr = codes.join(",");

    const token =
      form.querySelector('input[name="__RequestVerificationToken"]')?.value || "";
    const idVal = form.querySelector('input[name="Id"]')?.value || "";
    const returnUrl = form.querySelector('input[name="ReturnUrl"]')?.value || "";
    const paramVal = form.querySelector('input[name="Param"]')?.value || "";

    const captchaTextVal =
      form.querySelector('input[name="CaptchaText"]')?.value ||
      form.querySelector("#CaptchaText")?.value ||
      "";

    const idNameList = extractFieldNamesOrdered();
    const responseData = buildResponseData(idNameList);

    const body = new URLSearchParams();
    body.append("SelectedImages", selectedStr);
    body.append("Id", idVal);
    body.append("ReturnUrl", returnUrl);
    body.append("ResponseData", JSON.stringify(responseData));
    body.append("Param", paramVal);
    body.append("CaptchaText", captchaTextVal);
    if (token) body.append("__RequestVerificationToken", token);

    const NEW_APPOINTMENT_URL =
      "https://www.blsspainmorocco.net/MAR/appointment/newappointment";

    try {
      const resp = await fetch("/MAR/NewCaptcha/LoginCaptchaSubmit", {
        method: "POST",
        credentials: "include",
        redirect: "manual",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
        body: body.toString(),
      });

      const locRaw = resp.headers.get("Location") || "";
      const loc = locRaw.trim();

      let absLoc = "";
      let absLocLower = "";
      if (loc) {
        try {
          absLoc = new URL(loc, location.origin).toString();
          absLocLower = absLoc.toLowerCase();
        } catch {
          absLoc = loc;
          absLocLower = loc.toLowerCase();
        }
      }

      console.log(
        "[CALENDRIA][CAPTCHA] status:",
        resp.status,
        "type:",
        resp.type,
        "Location:",
        loc,
        "abs:",
        absLoc
      );
      if (resp.type === "opaqueredirect" || resp.status === 0) {
        console.log("[CALENDRIA][CAPTCHA] opaqueredirect/0 => treat as success");
        window.location.href = NEW_APPOINTMENT_URL;
        return;
      }

      if (resp.status === 302 || resp.status === 301) {
        if (!loc) {
          console.warn("[CALENDRIA][CAPTCHA] 302 بدون Location => retry");
          window.__calendria_loginCaptcha_fetchSent = false;
          location.replace(location.href);
          return;
        }
      }

      if (absLocLower.includes("/mar/newcaptcha/logincaptcha")) {
        console.warn("[CALENDRIA][CAPTCHA] Wrong captcha => retry");
        window.__calendria_loginCaptcha_fetchSent = false;
        location.replace(location.href);
        return;
      }

      const originLower = location.origin.toLowerCase();
      if (
        absLocLower === originLower ||
        absLocLower === originLower + "/" ||
        absLocLower === "https://www.blsspainmorocco.net" ||
        absLocLower === "https://www.blsspainmorocco.net/"
      ) {
        console.log(
          "[CALENDRIA][CAPTCHA] Success (root redirect) => go NewAppointment"
        );
        window.location.href = NEW_APPOINTMENT_URL;
        return;
      }

      if (resp.status === 302 || resp.status === 301) {
        const target = absLoc || new URL(loc, location.origin).toString();
        console.log("[CALENDRIA][CAPTCHA] Redirect to:", target);
        window.location.href = target;
        return;
      }

      if (resp.status === 200) {
        const text = await resp.text();

        if (/logincaptcha|captcha/i.test(text)) {
          console.warn("[CALENDRIA][CAPTCHA] Wrong captcha (200 body) => retry");
          window.__calendria_loginCaptcha_fetchSent = false;
          location.replace(location.href);
          return;
        }

        console.log("[CALENDRIA][CAPTCHA] Success (200) => go NewAppointment");
        window.location.href = NEW_APPOINTMENT_URL;
        return;
      }

      console.warn("[CALENDRIA][CAPTCHA] Unexpected status:", resp.status);
      window.__calendria_loginCaptcha_fetchSent = false;
    } catch (e) {
      console.error("[CALENDRIA][CAPTCHA] fetch error:", e);
      window.__calendria_loginCaptcha_fetchSent = false;
    }
  }

  // =============================================
  // Auto watcher: يراقب اختيار الصور + الباسوورد
  // =============================================
  function attachAutoFetchWatcher(passwordValue) {
    if (window.__calendria_fetch_watcher_attached) return;
    window.__calendria_fetch_watcher_attached = true;

    let tries = 0;
    const maxTries = 600;

    const t = setInterval(() => {
      tries++;

      const pwdOk = applyPasswordOnce(passwordValue);
      const codes = getSelectedImageCodes();

      if (
        !window.__calendria_loginCaptcha_fetchSent &&
        pwdOk &&
        codes.length
      ) {
        clearInterval(t);
        window.__calendria_loginCaptcha_fetchSent = true;

        const doSend = () => {
          console.log("[CALENDRIA][CAPTCHA] Ready → sending fetch.");
          sendLoginCaptchaFetch(passwordValue);
        };

        if (LC_USE_DELAY_CONFIG && LOGIN_CAPTCHA_DELAY_MS > 0) {
          console.log(
            "[CALENDRIA][CAPTCHA] Using LoginCaptcha delay (ms):",
            LOGIN_CAPTCHA_DELAY_MS
          );
          setTimeout(doSend, LOGIN_CAPTCHA_DELAY_MS);
        } else {
          doSend();
        }

        return;
      }

      if (tries > maxTries) {
        clearInterval(t);
        console.warn("[CALENDRIA][CAPTCHA] Auto watcher timeout.");
      }
    }, 50);
  }

  // ======================
  // NCAI LOGIN BOT
  // ======================
  class NoCaptchaLoginBot {
    constructor() {
      this._started = false;
    }

    _getCaptchaTarget() {
      const labels = Array.from(document.querySelectorAll(".box-label"));
      labels.sort(
        (a, b) =>
          (parseInt(getComputedStyle(b).zIndex) || 0) -
          (parseInt(getComputedStyle(a).zIndex) || 0)
      );
      if (!labels.length) return "";
      return (labels[0].textContent || "").replace(/\D+/, "");
    }

    _getCaptchaGrid() {
      const containers = Array.from(document.querySelectorAll("*")).filter((el) => {
        const first = el.firstElementChild;
        if (!first || !first.classList) return false;
        if (!first.classList.contains("captcha-img")) return false;
        if (el.offsetWidth <= 0 || el.offsetHeight <= 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      });

      const rows = {};
      containers.forEach((el) => {
        const topKey = Math.floor(el.offsetTop);
        (rows[topKey] ||= []).push(el);
      });

      return Object.values(rows)
        .sort((a, b) => a[0].offsetTop - b[0].offsetTop)
        .flatMap((row) => {
          const byZ = row
            .sort(
              (a, b) =>
                (parseInt(getComputedStyle(b).zIndex) || 0) -
                (parseInt(getComputedStyle(a).zIndex) || 0)
            )
            .slice(0, 3);
          return byZ.sort((a, b) => a.offsetLeft - b.offsetLeft);
        })
        .map((el) => el.firstElementChild)
        .filter(Boolean);
    }

    async _solveOnce() {
      if (__cal_captcha_mode !== "nocaptchaai") {
        console.log("[NCAI][Login] mode changed, abort.");
        return;
      }
      if (!__cal_captcha_apikey) {
        console.warn("[NCAI][Login] No apiKey configured, abort.");
        return;
      }

      const target = this._getCaptchaTarget();
      const grid = this._getCaptchaGrid();
      if (!target || !grid.length) {
        console.warn("[NCAI][Login] No target/grid yet.");
        return;
      }

      console.log("[NCAI][Login] target =", target, "gridLen=", grid.length);

      const images = Object.fromEntries(grid.map((img) => img.src).entries());

      try {
        const resp = await fetch("https://pro.nocaptchaai.com/solve", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apiKey: __cal_captcha_apikey,
          },
          body: JSON.stringify({
            method: "ocr",
            id: "morocco",
            images,
          }),
        });

        if (!resp.ok) {
          console.error("[NCAI][Login] HTTP error:", resp.status);
          return;
        }

        const result = await resp.json();
        if (result && result.status === "solved" && result.solution) {
          Object.entries(result.solution).forEach(([index, value]) => {
            if (String(value) === String(target) && grid[index]) {
              grid[index].click();
            }
          });
          console.log("[NCAI][Login] solution applied (click only).");
        } else {
          console.warn("[NCAI][Login] not solved:", result);
        }
      } catch (e) {
        console.error("[NCAI][Login] fetch error:", e);
      }
    }

    start() {
      if (this._started) return;
      this._started = true;

      console.log("[NCAI][Login] Bot started (mode = nocaptchaai)");

      let tries = 0;
      const maxTries = 400;

      const timer = setInterval(async () => {
        tries++;

        if (__cal_captcha_mode !== "nocaptchaai") {
          console.log("[NCAI][Login] mode switched away, stop.");
          clearInterval(timer);
          return;
        }

        const target = this._getCaptchaTarget();
        const grid = this._getCaptchaGrid();

        if (target && grid.length) {
          clearInterval(timer);
          await this._solveOnce();
          return;
        }

        if (tries > maxTries) {
          console.warn("[NCAI][Login] timeout waiting for captcha layout.");
          clearInterval(timer);
        }
      }, 80);
    }
  }

  function initNoCaptchaLoginIfEnabled() {
    if (__cal_captcha_mode !== "nocaptchaai") return;
    if (window.__ncai_login_started) return;
    window.__ncai_login_started = true;
    try {
      const bot = new NoCaptchaLoginBot();
      bot.start();
    } catch (e) {
      console.error("[NCAI][Login] init error:", e);
    }
  }

  // ==============================
  // AW8 SOLVER (LOGIN) - IMAGES ONLY
  // ==============================
  (function () {
    "use strict";

    class BaseAw8CaptchaBot {
      constructor(contextName = "AW8 Captcha") {
        this.contextName = contextName;
        this.verifyInterval = null;
        this._backoffMs = 100;
        this._backoffMin = 80;
        this._backoffMax = 2500;
        this._imgB64Cache = new WeakMap();
        this._appliedSolve = false;
      }

      _showCaptchaError(msg) {
        const escapeHtml = (s) =>
          String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const container = document.querySelector(".main-div-container");
        if (!container) return;
        let errorDiv = document.getElementById("captcha-error-banner");
        if (!errorDiv) {
          errorDiv = document.createElement("div");
          errorDiv.id = "captcha-error-banner";
          errorDiv.className =
            "d-flex align-items-center justify-content-center lead text-danger";
          container.prepend(errorDiv);
        }
        errorDiv.innerHTML = `<span class="spinner-grow"></span>&nbsp;Error: ${escapeHtml(
          msg
        )} — retrying...`;
      }

      _sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
      _resetBackoff() { this._backoffMs = this._backoffMin; }
      async _backoff() {
        const wait = Math.min(
          Math.max(this._backoffMs, this._backoffMin),
          this._backoffMax
        );
        await this._sleep(wait);
        this._backoffMs = Math.min(
          Math.floor(this._backoffMs * 1.6) + 20,
          this._backoffMax
        );
      }

      async _fetchWithTimeout(input, init = {}, timeoutMs = 15000) {
        const ctrl = new AbortController();
        const id = setTimeout(
          () => ctrl.abort(new DOMException("Timeout", "AbortError")),
          timeoutMs
        );
        try {
          return await fetch(input, { ...init, signal: ctrl.signal });
        } finally {
          clearTimeout(id);
        }
      }

      async _imgToBase64(imgEl) {
        const cached = this._imgB64Cache.get(imgEl);
        const sizeSig = `${imgEl.naturalWidth || imgEl.width}x${imgEl.naturalHeight || imgEl.height}`;
        if (cached && cached.sig === sizeSig) return cached.b64;

        const b64 = await new Promise((resolve, reject) => {
          try {
            const c = document.createElement("canvas");
            const w = imgEl.naturalWidth || imgEl.width;
            const h = imgEl.naturalHeight || imgEl.height;
            c.width = w;
            c.height = h;
            c.getContext("2d").drawImage(imgEl, 0, 0, w, h);
            resolve(c.toDataURL("image/png"));
          } catch (e) {
            reject(e);
          }
        });
        this._imgB64Cache.set(imgEl, { b64, sig: sizeSig });
        return b64;
      }

      getCaptchaTarget() {
        const labels = Array.from(document.querySelectorAll(".box-label"));
        labels.sort(
          (a, b) =>
            (parseInt(getComputedStyle(b).zIndex) || 0) -
            (parseInt(getComputedStyle(a).zIndex) || 0)
        );
        if (!labels.length) return null;
        return (labels[0].textContent || "").replace(/\D+/g, "");
      }

      getCaptchaGrid() {
        const containers = Array.from(document.querySelectorAll("*")).filter(
          (el) =>
            el.offsetWidth > 0 &&
            el.offsetHeight > 0 &&
            Array.from(el.children).some((ch) =>
              ch.classList.contains("captcha-img")
            )
        );
        const rows = {};
        containers.forEach((el) => {
          const key = Math.floor(el.offsetTop);
          (rows[key] ||= []).push(el);
        });
        return Object.values(rows)
          .sort((a, b) => a[0].offsetTop - b[0].offsetTop)
          .flatMap((row) => {
            const byZ = row
              .sort(
                (a, b) =>
                  (parseInt(getComputedStyle(b).zIndex) || 0) -
                  (parseInt(getComputedStyle(a).zIndex) || 0)
              )
              .slice(0, 3);
            return byZ.sort((a, b) => a.offsetLeft - b.offsetLeft);
          })
          .map((el) => el.querySelector(".captcha-img"))
          .filter(Boolean);
      }

      setupCommonUI({ client, tweakLayout = true } = {}) {
        try {
          if (typeof checkAndReloadOnCaptchaLimit === "function")
            checkAndReloadOnCaptchaLimit();
        } catch {}

        const overlay = document.querySelector(".global-overlay");
        if (overlay) overlay.style.backgroundColor = "rgba(0,0,0,0.3)";

        if (tweakLayout) {
          document
            .querySelectorAll("body > .row > [class^='col-']")
            .forEach((el) => (el.style.display = "none"));
        }

        if (client?.name || this.contextName) {
          document.title = client?.name || this.contextName;
        }

        let loadingEl;
        const mainContainer = document.querySelector(".main-div-container");
        if (mainContainer) {
          loadingEl = document.createElement("div");
          loadingEl.className =
            "d-flex align-items-center justify-content-center lead text-warning";
          loadingEl.innerHTML =
            '<span class="spinner-grow"></span>&nbsp;Solving captcha ...';
          mainContainer.insertBefore(loadingEl, mainContainer.firstChild);
        }
        return loadingEl;
      }

      async solveCaptchaAndSelectImagesOnly() {
        const REGISTRY_URL = "https://aw8.onrender.com/api/get";
        const CACHE_KEY = "aw8_server_url";

        const storage = {
          async get(k) {
            try {
              if (globalThis.chrome?.storage?.local) {
                const r = await chrome.storage.local.get(k);
                return r[k];
              }
            } catch {}
            try {
              return localStorage.getItem(k) || undefined;
            } catch {}
          },
          async set(k, v) {
            try {
              if (globalThis.chrome?.storage?.local) {
                return await chrome.storage.local.set({ [k]: v });
              }
            } catch {}
            try {
              localStorage.setItem(k, v);
            } catch {}
          },
        };

        const fetchIpsFromServer = async () => {
          const r = await fetch(REGISTRY_URL, { cache: "no-store" });
          const j = await r.json();
          if (j?.ok && j.lan && j.wan) return { lan: j.lan, wan: j.wan };
          if (j?.ok && j.clients && Object.keys(j.clients).length) {
            const firstKey = Object.keys(j.clients)[0];
            const c = j.clients[firstKey];
            if (c?.lan && c?.wan) return { lan: c.lan, wan: c.wan };
          }
          throw new Error("No LAN/WAN available from registry");
        };

        const trySolveAt = async (baseUrl, target, base64Images) => {
          const url = baseUrl.replace(/\/+$/, "") + "/solve";

          const resp = await this._fetchWithTimeout(
            url,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
              },
              body: JSON.stringify({ target, images: base64Images }),
            },
            15000
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        };

        const clickMatchesOnly = (grid, data, target) => {
          if (this._appliedSolve) return;

          let matches = null;
          if (Array.isArray(data)) matches = data;
          else if (data?.matches) matches = data.matches;
          else if (data?.status === "solved" && data.solution) {
            const arr = [];
            Object.entries(data.solution).forEach(([idx, val]) => {
              arr[Number(idx)] = String(val) === String(target) ? 1 : 0;
            });
            matches = arr;
          }

          if (!matches) throw new Error("Unexpected server response format");
          if (!matches.some((m) => m === 1 || m === true))
            throw new Error("No number found in response");

          matches.forEach((m, idx) => {
            if ((m === 1 || m === true) && grid[idx]) grid[idx].click();
          });

          this._appliedSolve = true;
          console.log("[✅] AW8 selected images only (no submit click).");
        };

        while (true) {
          try {
            if (__cal_captcha_mode === "nocaptchaai") {
              console.log("[AW8][Login] mode changed to NCAI, stopping solve loop.");
              break;
            }

            const target = this.getCaptchaTarget();
            if (!target) {
              this._showCaptchaError("No target number found");
              await this._backoff();
              continue;
            }

            const grid = this.getCaptchaGrid();
            if (!grid.length) {
              this._showCaptchaError("No captcha images found");
              await this._backoff();
              continue;
            }

            const base64Images = await Promise.all(
              grid.map((img) => this._imgToBase64(img))
            );

            const cached = await storage.get(CACHE_KEY);
            if (cached) {
              try {
                const data = await trySolveAt(cached, target, base64Images);
                this._resetBackoff();
                clickMatchesOnly(grid, data, target);
                break;
              } catch {}
            }

            const ips = await fetchIpsFromServer();
            const wan = ips.wan ? `http://${ips.wan}:5000` : null;
            const lan = ips.lan ? `http://${ips.lan}:5000` : null;

            const seq = [];
            if (wan) seq.push(wan);
            if (lan && lan !== wan) seq.push(lan);

            let solved = false;
            for (const base of seq) {
              try {
                const data = await trySolveAt(base, target, base64Images);
                await storage.set(CACHE_KEY, base);
                this._resetBackoff();
                clickMatchesOnly(grid, data, target);
                solved = true;
                break;
              } catch {}
            }

            if (solved) break;
            this._showCaptchaError("AW8 error: no reachable solver (WAN/LAN)");
            await this._backoff();
          } catch (e) {
            console.error(
              "[💥] solve attempt failed [" + this.contextName + "]:",
              e
            );
            this._showCaptchaError(
              e && e.message ? e.message : String(e)
            );
            await this._backoff();
          }
        }
      }
    }

    class LoginCaptchaBot extends BaseAw8CaptchaBot {
      constructor(client) {
        super(client?.name || "AW8 Login");
        this.client = client || {};
      }

      async start() {
        const loadingEl = this.setupCommonUI({
          client: this.client,
          tweakLayout: true,
        });

        try {
          await this.solveCaptchaAndSelectImagesOnly();
          loadingEl?.remove();
        } catch {
          loadingEl?.remove();
        }
      }
    }

    function matchPath(pattern, pathname = location.pathname) {
      const cleaned = pathname.replace(/\/\.[^/]+/g, "");
      const base = pattern.replace(/\/+$/, "");
      const escaped = base.replace(/[\\.*+^${}|()[\]]/g, "\\$&");
      const re = new RegExp("^" + escaped + "(?:/\\.[A-Za-z]{3})?/?$", "i");
      return re.test(cleaned);
    }

    // نخلي initAw8LoginCaptcha global باش نتحكم فيه حسب المود
    window.initAw8LoginCaptcha = function initAw8LoginCaptchaInner() {
      if (__cal_captcha_mode === "nocaptchaai") {
        console.log("[AW8][Login] Skipped because mode = NoCaptchaAI");
        return;
      }
      if (!matchPath("/MAR/newcaptcha/logincaptcha")) return;
      const bot = new LoginCaptchaBot({ name: "AW8 Login" });
      bot.start();
    };
  })();

  // ======================
  // INIT PASSWORD + WATCHER
  // ======================
  function waitAndInit() {
    let tries = 0;
    const maxTries = 200;

    const timer = setInterval(() => {
      tries++;

      if (getCaptchaForm()) {
        clearInterval(timer);
        loadStoredCode((code) => {
          startPasswordGuardian(code);
          attachAutoFetchWatcher(code);
        });
        return;
      }

      if (tries >= maxTries) {
        clearInterval(timer);
        console.warn("[CALENDRIA][CAPTCHA] Timeout waiting for form.");
      }
    }, 30);
  }

  // ======================
  // START ALL
  // ======================
  function markDomReadyAndMaybeStartSolvers() {
    __dom_ready = true;
    startSolversAccordingToMode();
  }

  waitAndInit();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markDomReadyAndMaybeStartSolvers);
  } else {
    markDomReadyAndMaybeStartSolvers();
  }
})();
