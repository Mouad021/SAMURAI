(() => {
  "use strict";

  // =========================
  // Page guard
  // =========================
  const PATH_OK = location.pathname.toLowerCase().includes("/mar/appointment/newappointment");
  if (!PATH_OK) return;

  if (window.__calendria_apptcaptcha_started) return;
  window.__calendria_apptcaptcha_started = true;

  console.log(
    "%c[CALENDRIA][AppointmentCaptcha] Loaded (REDIRECT ONLY / ONE POST + AW8/NCAI)",
    "color:#0ff;font-size:14px;"
  );

  // =========================
  // CAPTCHA MODE (AW8 / NoCaptchaAI)
  // =========================
  //  OFF  = "aw8"
  //  ON   = "nocaptchaai"
  let __cal_captcha_mode   = (window.__CAL_GLOBAL_CAPTCHA_MODE || "aw8");
  let __cal_captcha_apikey = (window.__CAL_GLOBAL_NCAI_KEY || "");
  let __captcha_settings_loaded = false;

  // =========================
  // POST URL (الحقيقي)
  // =========================
  const BASE_URL = "/MAR/appointment/appointmentcaptcha";

  // Guard لتفادي multi-POST بنفس التوكن
  const LAST_TOKEN_KEY = "calendria_apptcap_last_token";

  // حالة إرسال الطلب
  let __appt_state = "waiting"; // waiting → preparing → sent

  // =========================
  // Delay config (from popup)
  // =========================
  const DEFAULT_PRE_DELAY_MS = 1000;
  let PRE_DELAY_MS = DEFAULT_PRE_DELAY_MS;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(
        ["calendria_use_delays", "calendria_delay_apptcaptcha"],
        (res = {}) => {
          const useDelays = (res.calendria_use_delays || "off") === "on";
          const raw = (res.calendria_delay_apptcaptcha || "")
            .toString()
            .replace(",", ".");
          const n = parseFloat(raw);
          if (useDelays && !isNaN(n) && n >= 0) {
            PRE_DELAY_MS = Math.round(n * 1000);
          } else {
            PRE_DELAY_MS = DEFAULT_PRE_DELAY_MS;
          }
          console.log("[CALENDRIA][AppointmentCaptcha] Delay config:", {
            useDelays,
            PRE_DELAY_MS,
          });
        }
      );
    }
  } catch (e) {
    console.warn("[CALENDRIA][AppointmentCaptcha] cannot read delay config:", e);
  }

  // =========================
  // Helpers
  // =========================
  const qa = (sel) => Array.from(document.querySelectorAll(sel));

  function getToken() {
    const t = qa("input[name='__RequestVerificationToken']");
    return t.length ? (t[t.length - 1].value || "").trim() : "";
  }

  function getClientData() {
    const c = qa("input[name='ClientData']");
    return c.length ? (c[c.length - 1].value || "").trim() : "";
  }

  function getData() {
    const d = qa("input[name='Data']");
    return d.length ? (d[d.length - 1].value || "").trim() : "";
  }

  function getSelectedCodes() {
    return qa(".captcha-img.img-selected, .captcha-img.selected")
      .map((el) => {
        const oc = el.getAttribute("onclick") || "";
        const m = oc.match(/OnImageSelect\('([^']+)'\s*,/i);
        return m ? m[1] : null;
      })
      .filter(Boolean);
  }

  function buildBody() {
    const token = getToken();
    const data = getData();
    const clientData = getClientData();
    const codes = getSelectedCodes();

    return { token, data, clientData, codes };
  }

  // =========================
  // إرسال POST مع منطق redirect
  // =========================
  async function sendPOST(token, codes, data, clientData) {
    try {
      const body = new URLSearchParams();
      body.set("__RequestVerificationToken", token);
      body.set("SelectedImages", codes.join(","));
      body.set("Data", data);
      if (clientData) body.set("ClientData", clientData);

      console.log("[CALENDRIA][AppointmentCaptcha] POST →", BASE_URL, {
        tokenPresent: !!token,
        dataLen: (data || "").length,
        codes,
      });

      let resp;
      try {
        // نخلي المتصفح يتبع الريديركت عادي (follow)
        resp = await fetch(BASE_URL, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          body: body.toString(),
        });
      } catch (e) {
        console.error("[CALENDRIA][AppointmentCaptcha] fetch error:", e);
        return;
      }

      const status   = resp.status;
      const finalUrl = (resp.url || "").toLowerCase();

      console.log("[CALENDRIA][AppointmentCaptcha] final resp:", {
        status,
        finalUrl,
      });

      // ===== VisaType → نمشيو لها ونخرج =====
      if (finalUrl.includes("/mar/appointment/visatype")) {
        console.log("[CALENDRIA][AppointmentCaptcha] Final → VisaType, GO!");
        location.href = resp.url;
        return;
      }

      // ===== NewAppointment?msg= → نرجعو لنسخة نظيفة =====
      if (finalUrl.includes("/mar/appointment/newappointment?msg=")) {
        console.log(
          "[CALENDRIA][AppointmentCaptcha] Final → NewAppointment?msg=, reload clean /NewAppointment"
        );
        location.href = "/MAR/appointment/newappointment";
        return;
      }

      // ===== أي صفحة أخرى مختلفة → تبعها =====
      if (finalUrl && finalUrl !== location.href.toLowerCase()) {
        console.log(
          "[CALENDRIA][AppointmentCaptcha] Final → other page, following"
        );
        location.href = resp.url;
        return;
      }

      // ماكان لا redirect مهم لا تبديل → نبقاو فالكابتشا
      console.log(
        "[CALENDRIA][AppointmentCaptcha] Stay on captcha page (no redirect / same url)."
      );
    } catch (e) {
      console.error("[CALENDRIA][AppointmentCaptcha] sendPOST outer error:", e);
    }
  }

  // =========================
  // Loop يراقب الكابچا و يرسل POST مرة واحدة
  // =========================
  function loopPostOnce() {
    if (__appt_state !== "waiting") {
      requestAnimationFrame(loopPostOnce);
      return;
    }

    const body = buildBody();
    const token = body.token;
    const data = body.data;
    const clientData = body.clientData;
    const codes = body.codes;

    if (!token || !data || !codes.length) {
      requestAnimationFrame(loopPostOnce);
      return;
    }

    const lastToken = sessionStorage.getItem(LAST_TOKEN_KEY) || "";
    if (token === lastToken) {
      // نفس الكابچا / نفس التوكن → ما نعاودش POST
      requestAnimationFrame(loopPostOnce);
      return;
    }

    __appt_state = "preparing";
    console.log(
      "[CALENDRIA][AppointmentCaptcha] READY → wait " +
        PRE_DELAY_MS / 1000 +
        "s then POST (redirect only)"
    );

    setTimeout(async () => {
      if (__appt_state !== "preparing") {
        requestAnimationFrame(loopPostOnce);
        return;
      }

      const fresh = buildBody();
      if (
        !fresh.token ||
        !fresh.data ||
        !fresh.codes.length ||
        fresh.token !== token
      ) {
        console.warn(
          "[CALENDRIA][AppointmentCaptcha] Conditions changed before POST, retry..."
        );
        __appt_state = "waiting";
        requestAnimationFrame(loopPostOnce);
        return;
      }

      // حفظ آخر توكن
      sessionStorage.setItem(LAST_TOKEN_KEY, fresh.token);

      __appt_state = "sent";
      await sendPOST(fresh.token, fresh.codes, fresh.data, fresh.clientData);
    }, PRE_DELAY_MS);

    requestAnimationFrame(loopPostOnce);
  }

  loopPostOnce();

  // =========================
  // NoCaptchaAI solver (Appointment) — يختار الصور فقط
  // =========================
  class NoCaptchaAppointmentBot {
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
        console.log("[NCAI][Appointment] mode changed, abort.");
        return;
      }
      if (!__cal_captcha_apikey) {
        console.warn("[NCAI][Appointment] No apiKey configured, abort.");
        return;
      }

      const target = this._getCaptchaTarget();
      const grid = this._getCaptchaGrid();
      if (!target || !grid.length) {
        console.warn("[NCAI][Appointment] No target/grid yet.");
        return;
      }

      console.log("[NCAI][Appointment] target =", target, "gridLen=", grid.length);

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
          console.error("[NCAI][Appointment] HTTP error:", resp.status);
          return;
        }

        const result = await resp.json();
        if (result && result.status === "solved" && result.solution) {
          Object.entries(result.solution).forEach(([index, value]) => {
            if (String(value) === String(target) && grid[index]) {
              grid[index].click();
            }
          });
          console.log("[NCAI][Appointment] solution applied (click only).");
        } else {
          console.warn("[NCAI][Appointment] not solved:", result);
        }
      } catch (e) {
        console.error("[NCAI][Appointment] fetch error:", e);
      }
    }

    start() {
      if (this._started) return;
      this._started = true;

      console.log("[NCAI][Appointment] Bot started (mode = nocaptchaai)");

      let tries = 0;
      const maxTries = 400;

      const timer = setInterval(async () => {
        tries++;

        if (__cal_captcha_mode !== "nocaptchaai") {
          console.log("[NCAI][Appointment] mode switched away, stop.");
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
          console.warn("[NCAI][Appointment] timeout waiting for captcha layout.");
          clearInterval(timer);
        }
      }, 80);
    }
  }

  function initNoCaptchaAppointmentIfEnabled() {
    if (!__captcha_settings_loaded) return;
    if (__cal_captcha_mode !== "nocaptchaai") {
      console.log("[NCAI][Appointment] init skipped (mode != nocaptchaai)");
      return;
    }
    if (window.__ncai_appt_started) return;
    window.__ncai_appt_started = true;
    try {
      const bot = new NoCaptchaAppointmentBot();
      bot.start();
    } catch (e) {
      console.error("[NCAI][Appointment] init error:", e);
    }
  }

  // =========================
  // AW8 solver (يختار الصور فقط)
  // =========================
  class BaseAw8CaptchaBot {
    constructor(contextName = "AW8 Captcha") {
      this.contextName = contextName;
      this._backoffMs  = 100;
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

    _sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    _resetBackoff() {
      this._backoffMs = this._backoffMin;
    }

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
      const txt = labels[0].textContent || "";
      return txt.replace(/\D+/g, "");
    }

    getCaptchaGrid() {
      const containers = Array.from(document.querySelectorAll("*")).filter((el) =>
        Array.from(el.children).some((ch) => ch.classList.contains("captcha-img"))
      );

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
        .map((el) => el.querySelector(".captcha-img"))
        .filter(Boolean);
    }

    setupCommonUI() {
      try {
        if (typeof checkAndReloadOnCaptchaLimit === "function") {
          checkAndReloadOnCaptchaLimit();
        }
      } catch {}

      const overlay = document.querySelector(".global-overlay");
      if (overlay) overlay.style.backgroundColor = "rgba(0,0,0,0.30)";

      const mainContainer = document.querySelector(".main-div-container");
      let loadingEl;
      if (mainContainer) {
        loadingEl = document.createElement("div");
        loadingEl.className =
          "d-flex align-items-center justify-content-center lead text-warning";
        loadingEl.innerHTML =
          '<span class="spinner-grow"></span>&nbsp;Solving captcha (AW8) ...';
        mainContainer.insertBefore(loadingEl, mainContainer.firstChild);
      }

      return loadingEl;
    }

    async solveCaptchaAndApply() {
      const REGISTRY_URL = "https://aw8.onrender.com/api/get";
      const CACHE_KEY = "aw8_server_url_appointment";

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

        if (globalThis.chrome?.runtime?.id) {
          return await new Promise((resolve, reject) => {
            let done = false;
            const killer = setTimeout(() => {
              if (!done) {
                done = true;
                reject(new Error("BG fetch hard timeout"));
              }
            }, 16000);

            chrome.runtime.sendMessage(
              {
                type: "aw8_solve",
                url,
                payload: { target, images: base64Images },
                timeout: 15000,
              },
              (resp) => {
                clearTimeout(killer);
                if (done) return;
                done = true;

                if (chrome.runtime.lastError)
                  return reject(new Error(chrome.runtime.lastError.message));
                if (!resp) return reject(new Error("No response from background"));
                if (!resp.ok)
                  return reject(new Error(`HTTP ${resp.status || "ERR"}`));

                try {
                  resolve(JSON.parse(resp.body));
                } catch {
                  reject(new Error("Invalid JSON from background"));
                }
              }
            );
          });
        }

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

        if (Array.isArray(data)) {
          matches = data;
        } else if (data?.matches) {
          matches = data.matches;
        } else if (data?.status === "solved" && data.solution) {
          const arr = [];
          Object.entries(data.solution).forEach(([idx, val]) => {
            arr[Number(idx)] = String(val) === String(target) ? 1 : 0;
          });
          matches = arr;
        }

        if (!matches)
          throw new Error("Unexpected server response format (no matches)");

        if (!matches.some((m) => m === 1 || m === true))
          throw new Error("No number found in response");

        matches.forEach((m, idx) => {
          if ((m === 1 || m === true) && grid[idx]) {
            grid[idx].click();
          }
        });

        this._appliedSolve = true;
        console.log("[✅] AW8 selected images only (no submit click).");
      };

      const loadingEl = this.setupCommonUI();

      while (true) {
        try {
          // gate runtime: إذا تبدل المود لنـ NCAI نوقف فوراً
          if (__cal_captcha_mode === "nocaptchaai") {
            console.log("[AW8][Appointment] mode = NCAI, stop AW8 loop.");
            loadingEl?.remove();
            break;
          }

          const target = this.getCaptchaTarget();
          if (!target) {
            await this._backoff();
            continue;
          }

          const grid = this.getCaptchaGrid();
          if (!grid.length) {
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
              loadingEl?.remove();
              break;
            } catch (err) {
              console.warn("[AW8][Appointment] cached solver failed:", err);
            }
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
              loadingEl?.remove();
              solved = true;
              break;
            } catch (err) {
              console.warn("[AW8][Appointment] solver failed @", base, err);
            }
          }

          if (solved) break;
          await this._backoff();
        } catch (err) {
          console.error("[AW8][Appointment] fatal error:", err);
          const msg = err && err.message ? err.message : String(err);
          if (/registry|reachable solver|unavailable/i.test(msg)) {
            this._showCaptchaError("Error: AW8 registry unavailable — retrying...");
          }
          await this._backoff();
        }
      }
    }
  }

  class AppointmentCaptchaBot extends BaseAw8CaptchaBot {
    constructor() {
      super("AW8 Appointment Captcha");
    }
    start() {
      this.solveCaptchaAndApply();
    }
  }

  function initAw8AppointmentCaptcha() {
    if (!__captcha_settings_loaded) return;
    if (__cal_captcha_mode === "nocaptchaai") {
      console.log("[AW8][Appointment] Skipped because mode = NoCaptchaAI");
      return;
    }
    if (window.__aw8_apptcaptcha_started) return;
    window.__aw8_apptcaptcha_started = true;
    new AppointmentCaptchaBot().start();
  }

  // =========================
  // CAPTCHA MODE bootstrap
  // =========================
  function onCaptchaSettingsReady() {
    __captcha_settings_loaded = true;

    console.log(
      "[CALENDRIA][AppointmentCaptcha] Settings ready → mode =",
      __cal_captcha_mode
    );

    try {
      if (__cal_captcha_mode === "nocaptchaai") {
        console.log("[CALENDRIA][AppointmentCaptcha] Using NoCaptchaAI (button = ON)");
        initNoCaptchaAppointmentIfEnabled();
      } else {
        console.log("[CALENDRIA][AppointmentCaptcha] Using AW8 (button = OFF)");
        initAw8AppointmentCaptcha();
      }
    } catch (e) {
      console.warn("[CALENDRIA][AppointmentCaptcha] init error:", e);
    }
  }

  // قراءة الإعدادات من popup مرة واحدة
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(
        ["cal_captcha_mode", "cal_captcha_apikey"],
        (res = {}) => {
          __cal_captcha_mode   = res.cal_captcha_mode   || "aw8";
          __cal_captcha_apikey = res.cal_captcha_apikey || "";

          // نخزنهم حتى فـ window باش باقي الصفحات تشوف نفس المود
          window.__CAL_GLOBAL_CAPTCHA_MODE = __cal_captcha_mode;
          window.__CAL_GLOBAL_NCAI_KEY     = __cal_captcha_apikey;

          console.log(
            "[CALENDRIA][AppointmentCaptcha][CAPTCHA] mode from popup =",
            __cal_captcha_mode,
            "apiKey.len=",
            __cal_captcha_apikey.length
          );

          onCaptchaSettingsReady();
        }
      );
    } else {
      console.warn("[CALENDRIA][AppointmentCaptcha] chrome.storage.local not available, using defaults.");
      onCaptchaSettingsReady();
    }
  } catch (e) {
    console.warn("[CALENDRIA][AppointmentCaptcha] failed to read captcha mode/apikey:", e);
    onCaptchaSettingsReady();
  }

})();
