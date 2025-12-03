// == CALENDRIA VisaType helper (FULL AUTO POST with fetch + true ResponseData) ==

(function () {
  if (window.__calendria_vt_injected) return;
  window.__calendria_vt_injected = true;

  const LOG = "[CALENDRIA][VisaType]";

  function log(...a) { console.log(LOG, ...a); }
  function warn(...a) { console.warn(LOG, ...a); }

  function isVisaTypePage() {
    const href = String(location.href || "").toLowerCase();
    return href.includes("/mar/appointment/visatype");
  }

  function safeArray(x) { return Array.isArray(x) ? x : []; }

  // ---------- 1) قراءة الآراي من السكريبتات ----------
  function extractArrayFromScripts(varName) {
    const re = new RegExp("var\\s+" + varName + "\\s*=\\s*(\\[[\\s\\S]*?\\]);");
    const scripts = Array.from(document.scripts || []);
    for (const s of scripts) {
      const txt = s.textContent || "";
      const m = re.exec(txt);
      if (m && m[1]) {
        try {
          const arr = JSON.parse(m[1]);
          if (Array.isArray(arr)) {
            log(`parsed ${varName} from inline <script>, len =`, arr.length);
            return arr;
          }
        } catch { /* ignore */ }
      }
    }
    return [];
  }

  function getPageArrays() {
    let locationData  = safeArray(window.locationData);
    let visaIdData    = safeArray(window.visaIdData);
    let visasubIdData = safeArray(window.visasubIdData);
    let categoryData  = safeArray(window.categoryData);

    if (!locationData.length)  locationData  = extractArrayFromScripts("locationData");
    if (!visaIdData.length)    visaIdData    = extractArrayFromScripts("visaIdData");
    if (!visasubIdData.length) visasubIdData = extractArrayFromScripts("visasubIdData");
    if (!categoryData.length)  categoryData  = extractArrayFromScripts("categoryData");

    log("page arrays (from scripts):", {
      locationData:  locationData.length,
      visaIdData:    visaIdData.length,
      visasubIdData: visasubIdData.length,
      categoryData:  categoryData.length,
    });

    return { locationData, visaIdData, visasubIdData, categoryData };
  }

  // applicantsNoData (Number Of Members) من الصفحة
  function getApplicantsNoData() {
    let arr = safeArray(window.applicantsNoData);
    if (!arr.length) {
      arr = extractArrayFromScripts("applicantsNoData");
    }
    log("[VT] applicantsNoData length:", arr.length);
    return arr;
  }

  // ---------- 2) قراءة اختيارات الـ popup ----------
  function loadPopupChoices() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve({ locName: "", vsName: "", vsSubName: "", catName: "" });
        return;
      }

      chrome.storage.local.get(
        [
          "calendria_location_name",
          "calendria_visatype_name",
          "calendria_visasub_name",
          "calendria_category_name",
        ],
        (res = {}) => {
          const choices = {
            locName:   (res.calendria_location_name || "").trim(),
            vsName:    (res.calendria_visatype_name || "").trim(),
            vsSubName: (res.calendria_visasub_name || "").trim(),
            catName:   (res.calendria_category_name || "").trim(),
          };
          log("popup choices:", choices);
          resolve(choices);
        }
      );
    });
  }

  // ---------- 2.5) قراءة اختيار Number Of Members من الإضافة / الصفحة ----------
  function loadMembersCount() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        let n = 0;
        if (typeof window.numberofapplicants !== "undefined") {
          n = parseInt(window.numberofapplicants, 10);
        }
        resolve(n);
        return;
      }
      chrome.storage.local.get(["calendria_members_count"], (res = {}) => {
        let n = parseInt(res.calendria_members_count, 10);
        if (!isFinite(n) || n <= 0) {
          if (typeof window.numberofapplicants !== "undefined") {
            n = parseInt(window.numberofapplicants, 10);
          }
        }
        if (!isFinite(n) || n <= 0) n = 0;
        log("[VT] membersCount from storage/page:", n);
        resolve(n);
      });
    });
  }

  // ---------- 3) تحويل الأسماء إلى IDs ----------
  function resolveIds(arrays, choices) {
    const { locationData, visaIdData, visasubIdData, categoryData } = arrays;
    const { locName, vsName, vsSubName, catName } = choices;

    const result = {
      locationId:    "",
      visaTypeId:    "",
      visaSubTypeId: "",
      categoryId:    "",
    };

    if (!locationData.length || !visaIdData.length || !visasubIdData.length || !categoryData.length) {
      warn("cannot resolve IDs, one of arrays is empty");
      return result;
    }

    const loc = locationData.find(
      (x) => String(x.Name || "").toLowerCase() === String(locName || "").toLowerCase()
    );
    if (!loc) { warn("location not found for", locName); return result; }
    result.locationId = String(loc.Id || "");

    const vs = visaIdData.find(
      (x) => String(x.Name || "").toLowerCase() === String(vsName || "").toLowerCase()
    );
    if (!vs) { warn("visaType not found for", vsName); return result; }
    result.visaTypeId = String(vs.Id || "");

    const vsSub = visasubIdData.find(
      (x) => String(x.Name || "").toLowerCase() === String(vsSubName || "").toLowerCase()
    );
    if (!vsSub) { warn("visaSubType not found for", vsSubName); return result; }
    result.visaSubTypeId = String(vsSub.Id || "");

    const cat = categoryData.find(
      (x) =>
        String(x.LegalEntityId || "") === result.locationId &&
        String(x.Name || "").toLowerCase() === String(catName || "").toLowerCase()
    );
    if (!cat) {
      warn("category not found for", catName, "at locationId", result.locationId);
      return result;
    }
    result.categoryId = String(cat.Id || "");

    log("resolved IDs:", result);
    return result;
  }

  // ---------- 4) تحديد input ديال كل حقل ----------
  function findVisibleFieldInputs(form) {
    const elements = form.querySelectorAll(".mb-3");
    let categoryId = null;
    let locationId = null;
    let visaTypeId = null;
    let visaSubTypeId = null;

    elements.forEach((node) => {
      const cs = window.getComputedStyle(node);
      if (cs.display === "none") return;

      const label  = node.querySelector("label");
      const select = node.querySelector("span.k-select");
      if (!label || !select) return;

      const labelText = (label.textContent || "").trim();
      const labelId   = label.getAttribute("for");

      if (!labelId) return;

      if (labelText.includes("Category"))           categoryId    = labelId;
      else if (labelText.includes("Location"))      locationId    = labelId;
      else if (labelText.includes("Visa Type"))     visaTypeId    = labelId;
      else if (labelText.includes("Visa Sub Type")) visaSubTypeId = labelId;
    });

    const res = { locationId, visaTypeId, visaSubTypeId, categoryId };
    log("visible field inputs:", res);
    return res;
  }

  // نفس الطريقة لكن لـ Number Of Members
  function findMembersFieldInput(form) {
    const elements = form.querySelectorAll(".mb-3");
    let membersId = null;

    elements.forEach((node) => {
      const cs = window.getComputedStyle(node);
      if (cs.display === "none") return;

      const label  = node.querySelector("label");
      const select = node.querySelector("span.k-select");
      if (!label || !select) return;

      const labelText = (label.textContent || "").trim();
      const labelId   = label.getAttribute("for");
      if (!labelId) return;

      if (labelText.toLowerCase().includes("number of members")) {
        membersId = labelId;
      }
    });

    if (membersId) {
      log("[VT] found Number Of Members field id:", membersId);
    } else {
      log("[VT] Number Of Members field not found (maybe hidden?)");
    }
    return membersId;
  }

  // ---------- 5) حقن قيمة في dropdown / input ----------
  function forceValueIntoField(id, value) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) {
      warn("forceValueIntoField: element not found", id);
      return;
    }

    let usedKendo = false;
    const $el = window.jQuery ? window.jQuery(el) : null;

    if ($el && $el.data && $el.data("kendoDropDownList")) {
      const ddl = $el.data("kendoDropDownList");
      try {
        ddl.value(String(value));
        ddl.trigger("change");
        usedKendo = true;
      } catch (e) {
        warn("kendoDropDownList.value error for", id, e);
      }
    } else {
      el.value = String(value);
    }

    log("[VT] INJECT", {
      elementId: id,
      injectedValue: String(value),
      kendo: usedKendo,
    });
  }

  // -------- AppointmentFor: قراءة من DOM --------
  function readAppointmentForFromDom(form) {
    // 1) hidden AppointmentFor إذا كاين
    const hidden = form.querySelector('[name="AppointmentFor"]');
    if (hidden && hidden.value) {
      const v = String(hidden.value).trim();
      if (v) return v;
    }

    // 2) الراديوهات الجديدة: value = "Family" / "Individual"
    const familyChecked = form.querySelector(
      'input[type="radio"][value="Family"]:checked'
    );
    const indivChecked = form.querySelector(
      'input[type="radio"][value="Individual"]:checked'
    );

    if (familyChecked) return "Family";
    if (indivChecked)  return "Individual";

    // 3) fallback للـ IDs القديمة
    const familyById = form.querySelector(
      'input[type="radio"][id^="family"]:checked'
    );
    const selfById = form.querySelector(
      'input[type="radio"][id^="self"]:checked'
    );
    if (familyById) return "Family";
    if (selfById)   return "Individual";

    return "";
  }

  // نفضّل قيمة المخزن calendria_appointment_for إن وُجدت
  function getAppointmentForValue(form) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve(readAppointmentForFromDom(form));
        return;
      }

      chrome.storage.local.get(["calendria_appointment_for"], (res = {}) => {
        const raw = (res.calendria_appointment_for || "").toString().trim().toLowerCase();

        if (raw === "family") {
          resolve("Family");
        } else if (raw === "individual") {
          resolve("Individual");
        } else {
          resolve(readAppointmentForFromDom(form));
        }
      });
    });
  }

  // ---------- 5.5) حقن Number Of Members (فقط إذا Family) ----------
  async function applyMembersField(form) {
    const apptFor = await getAppointmentForValue(form);
    if (apptFor !== "Family") {
      log("[VT] AppointmentFor != Family → skipping members injection");
      return;
    }

    const membersCount = await loadMembersCount();
    if (!membersCount || membersCount < 2) {
      log("[VT] membersCount < 2 → skipping members injection");
      return;
    }

    const applicants = getApplicantsNoData();
    if (!applicants.length) {
      warn("[VT] applicantsNoData empty → cannot map members");
      return;
    }

    const label = membersCount + " Members";
    const item = applicants.find(
      (x) => String(x.Name || "").toLowerCase() === label.toLowerCase()
    );
    if (!item) {
      warn("[VT] no applicantsNoData match for", label);
      return;
    }

    const value = item.Id || item.Value;
    if (!value) {
      warn("[VT] applicantsNoData match has no Id/Value:", item);
      return;
    }

    const membersId = findMembersFieldInput(form);
    if (!membersId) {
      warn("[VT] members field input not found, maybe not visible");
      return;
    }

    forceValueIntoField(membersId, value);
    log("[VT] members injected:", { membersId, value });
  }

  // ---------- 6) delay ----------
  function loadDelayMs() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve(0);
        return;
      }

      chrome.storage.local.get(
        ["calendria_use_delays", "calendria_delay_visatype"],
        (res = {}) => {

          const master = res.calendria_use_delays === "on";

          if (!master) {
            log("[VT] Delay master OFF → sending instantly (0 ms)");
            resolve(0);
            return;
          }

          let raw = (res.calendria_delay_visatype || "")
            .toString()
            .trim()
            .replace(",", ".");
          let sec = parseFloat(raw);

          if (!isFinite(sec) || sec < 0) sec = 0;

          const ms = Math.round(sec * 1000);
          log("[VT] Delay master ON → waiting", ms, "ms");
          resolve(ms);
        }
      );
    });
  }

  // ---------- 7) قراءة submittedData من سكريبت الصفحة ----------
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
      const re = /([a-zA-Z0-9_]+)\s*:\s*\$\("#([^"]+)"\)\.val\(\)/g;
      const out = [];
      let mm;
      while ((mm = re.exec(body))) {
        const name = mm[1];
        const id   = mm[2];
        out.push({ name, id });
      }
      if (out.length) {
        log("[VT] parsed submittedData map from page script:", out);
        return out;
      }
    }
    warn("[VT] could not parse submittedData map, fallback mode");
    return [];
  }

  // ---------- 8) بناء ResponseData ----------
  function buildResponseDataObject(form) {
    const map = parseSubmittedDataSpec();

    if (map.length) {
      const obj = {};
      for (let i = 0; i < map.length && i < 25; i++) {
        const { name, id } = map[i];
        const el = document.getElementById(id);
        const val = el ? el.value : "";
        obj[name] = val;
      }
      log("[VT] ResponseData built from submittedData map (<=25 keys):", obj);
      return obj;
    }

    const keys = [];
    const seen = new Set();
    function pushKey(k) {
      if (!k || seen.has(k)) return;
      seen.add(k);
      keys.push(k);
    }

    const hiddenInputs = form.querySelectorAll('input[type="hidden"][name]');
    for (const el of hiddenInputs) {
      const name = el.name;
      if (
        name === "Data" ||
        name === "DataSource" ||
        name === "ResponseData" ||
        name === "AppointmentFor" ||
        name === "ReCaptchaToken" ||
        name === "__RequestVerificationToken"
      ) continue;
      pushKey(name);
      if (keys.length >= 25) break;
    }

    const obj = {};
    for (const name of keys) {
      const el = document.getElementById(name) ||
                 document.getElementById("an" + name);
      obj[name] = el ? el.value : "";
    }
    log("[VT] ResponseData built (fallback, first 25 keys):", obj);
    return obj;
  }

  // ---------- 8.5) مزامنة الراديو ديال AppointmentFor ----------
  function syncAppointmentForRadios(form, apptForVal) {
    if (!apptForVal) return;

    const radios = form.querySelectorAll(
      'input[type="radio"][value="Family"], ' +
      'input[type="radio"][value="Individual"]'
    );

    radios.forEach((r) => {
      if (apptForVal === "Family" && r.value === "Family") {
        r.checked = true;
      } else if (apptForVal === "Individual" && r.value === "Individual") {
        r.checked = true;
      }
    });

    const hidden = form.querySelector('[name="AppointmentFor"]');
    if (hidden) hidden.value = apptForVal;
  }

  // ---------- 9) بناء البايلود و الإرسال بـ fetch ----------
  async function buildPayloadAndSend(form) {
    if (window.__cal_vt_sent) {
      warn("already sent once, skipping");
      return;
    }
    window.__cal_vt_sent = true;

    const respObj = buildResponseDataObject(form);
    const respInput = form.querySelector('[name="ResponseData"]');
    if (respInput) {
      respInput.value = JSON.stringify(respObj);
    }

    const dataInput  = form.querySelector('[name="Data"]');
    const dsInput    = form.querySelector('[name="DataSource"]');
    const tokenInput = form.querySelector('[name="__RequestVerificationToken"]');
    const recInput   = form.querySelector('[name="ReCaptchaToken"]');

    const dataVal  = dataInput  ? dataInput.value  : "";
    const dsVal    = dsInput    ? dsInput.value    : "WEB_BLS";
    const tokenVal = tokenInput ? tokenInput.value : "";
    const recVal   = recInput   ? recInput.value   : "";

    // 1) نجيب AppointmentFor ونزامن الراديو/hidden
    const apptForVal = await getAppointmentForValue(form);
    syncAppointmentForRadios(form, apptForVal);

    // 2) دابا نبني FormData باش يشمل الاسم العشوائي ديال الراديو (afnyulwebee=Family ...)
    const fd = new FormData(form);

    // 3) نضبط الحقول الخاصة
    fd.set("Data", dataVal);
    fd.set("DataSource", dsVal);
    fd.set("AppointmentFor", apptForVal);
    fd.set("ReCaptchaToken", recVal);
    fd.set("__RequestVerificationToken", tokenVal);
    fd.set("ResponseData", JSON.stringify(respObj));

    const params = new URLSearchParams();
    fd.forEach((v, k) => params.append(k, v));

    const objPreview = {};
    params.forEach((v, k) => { objPreview[k] = v; });

    log("[VT] FULL BUILT PAYLOAD OBJECT:", objPreview);
    log("[VT] FULL BUILT PAYLOAD RAW:", params.toString());

    const delayMs = await loadDelayMs();
    log("[VT] waiting", delayMs, "ms before custom POST...");

    setTimeout(async () => {
      const url = "/MAR/Appointment/VisaType";
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1"
      };

      try {
        log("[VT] sending custom POST to", url);

        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: params.toString(),
          credentials: "include",
          redirect: "manual"
        });

        log("[VT] custom POST status:", resp.status);

        const qs = new URLSearchParams(window.location.search || "");
        const dataFromUrl = qs.get("data") || "";
        const slotData = dataVal || dataFromUrl;

        if (!slotData) {
          warn("[VT] no Data token found (input + URL) → cannot build SlotSelection URL");
          return;
        }

        if (chrome?.storage?.local) {
          chrome.storage.local.get(["calendria_location_name"], (res = {}) => {
            const rawLoc   = (res.calendria_location_name || "").toString().trim();
            const locUpper = rawLoc.toUpperCase();

            const slotUrl =
              "/MAR/Appointment/SlotSelection?data=" +
              encodeURIComponent(slotData) +
              (locUpper ? "&loc=" + encodeURIComponent(locUpper) : "");

            log("[VT] redirect to SlotSelection →", slotUrl);
            location.href = slotUrl;
          });
        } else {
          const slotUrl =
            "/MAR/Appointment/SlotSelection?data=" +
            encodeURIComponent(slotData);
          log("[VT] redirect to SlotSelection (no storage) →", slotUrl);
          location.href = slotUrl;
        }

      } catch (e) {
        console.error(LOG, "error in custom POST", e);
      }
    }, delayMs);
  }

  // ---------- 10) main ----------
  async function main() {
    if (!isVisaTypePage()) return;

    log("started");

    const form =
      document.getElementById("visatypeform") || document.querySelector("form");
    if (!form) {
      warn("no form found in main document");
      return;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      warn("native form submit intercepted (custom CALENDRIA flow will send instead)");
    });

    const arrays   = getPageArrays();
    const choices  = await loadPopupChoices();

    if (!choices.locName && !choices.vsName && !choices.vsSubName && !choices.catName) {
      warn("choices empty → nothing to fill / send");
      return;
    }

    const ids = resolveIds(arrays, choices);
    if (!ids.locationId || !ids.visaTypeId || !ids.visaSubTypeId || !ids.categoryId) {
      warn("could not resolve all IDs, aborting send");
      return;
    }

    const fields = findVisibleFieldInputs(form);
    if (fields.locationId)    forceValueIntoField(fields.locationId,    ids.locationId);
    if (fields.visaTypeId)    forceValueIntoField(fields.visaTypeId,    ids.visaTypeId);
    if (fields.visaSubTypeId) forceValueIntoField(fields.visaSubTypeId, ids.visaSubTypeId);
    if (fields.categoryId)    forceValueIntoField(fields.categoryId,    ids.categoryId);

    // members (فقط إذا Family)
    await applyMembersField(form);

    await buildPayloadAndSend(form);
    log("[VT] fields filled + payload built, custom POST scheduled.");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(main, 300);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(main, 300));
  }
})();
