// == CALENDRIA VisaType helper (FULL AUTO POST with fetch + true ResponseData) ==

(function () {
  if (window.__calendria_vt_injected) return;
  window.__calendria_vt_injected = true;

  const LOG = "[CALENDRIA][VisaType]";
  const log  = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  function isVisaTypePage() {
    return String(location.href || "").toLowerCase().includes("/mar/appointment/visatype");
  }
  function safeArray(x) { return Array.isArray(x) ? x : []; }

  // ---------- 1) قراءة الآراي من السكريبتات ----------
  function extractArrayFromScripts(varName) {
    const re = new RegExp("var\\s+" + varName + "\\s*=\\s*(\\[[\\s\\S]*?\\]);");
    for (const s of Array.from(document.scripts || [])) {
      const txt = s.textContent || "";
      const m = re.exec(txt);
      if (m && m[1]) {
        try {
          const arr = JSON.parse(m[1]);
          if (Array.isArray(arr)) {
            log(`parsed ${varName} from inline <script>, len=`, arr.length);
            return arr;
          }
        } catch {}
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

    log("page arrays:", {
      locationData:  locationData.length,
      visaIdData:    visaIdData.length,
      visasubIdData: visasubIdData.length,
      categoryData:  categoryData.length,
    });

    return { locationData, visaIdData, visasubIdData, categoryData };
  }

  // Number Of Members
  function getApplicantsNoData() {
    let arr = safeArray(window.applicantsNoData);
    if (!arr.length) arr = extractArrayFromScripts("applicantsNoData");
    log("[VT] applicantsNoData length:", arr.length);
    return arr;
  }

  // ---------- 2) popup choices ----------
  function loadPopupChoices() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
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
            locName:   (res.calendria_location_name  || "").trim(),
            vsName:    (res.calendria_visatype_name  || "").trim(),
            vsSubName: (res.calendria_visasub_name   || "").trim(),
            catName:   (res.calendria_category_name  || "").trim(),
          };
          log("popup choices:", choices);
          resolve(choices);
        }
      );
    });
  }

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
        log("[VT] membersCount:", n);
        resolve(n);
      });
    });
  }

  // ---------- 3) resolve IDs ----------
  function resolveIds(arrays, choices) {
    const { locationData, visaIdData, visasubIdData, categoryData } = arrays;
    const { locName, vsName, vsSubName, catName } = choices;
    const res = { locationId: "", visaTypeId: "", visaSubTypeId: "", categoryId: "" };

    if (!locationData.length || !visaIdData.length || !visasubIdData.length || !categoryData.length) {
      warn("resolveIds: some arrays empty");
      return res;
    }

    const loc = locationData.find(x => String(x.Name || "").toLowerCase() === locName.toLowerCase());
    if (!loc) { warn("location not found", locName); return res; }
    res.locationId = String(loc.Id || "");

    const vs = visaIdData.find(x => String(x.Name || "").toLowerCase() === vsName.toLowerCase());
    if (!vs) { warn("visaType not found", vsName); return res; }
    res.visaTypeId = String(vs.Id || "");

    const vsSub = visasubIdData.find(x => String(x.Name || "").toLowerCase() === vsSubName.toLowerCase());
    if (!vsSub) { warn("visaSubType not found", vsSubName); return res; }
    res.visaSubTypeId = String(vsSub.Id || "");

    const cat = categoryData.find(
      x =>
        String(x.LegalEntityId || "") === res.locationId &&
        String(x.Name || "").toLowerCase() === catName.toLowerCase()
    );
    if (!cat) { warn("category not found", catName); return res; }
    res.categoryId = String(cat.Id || "");

    log("resolved IDs:", res);
    return res;
  }

  // ---------- 4) find visible dropdown inputs ----------
  function findVisibleFieldInputs(form) {
    const elements = form.querySelectorAll(".mb-3");
    let categoryId = null,
        locationId = null,
        visaTypeId = null,
        visaSubTypeId = null,
        appointmentForId = null;   // 🆕 هنا غادي نخزنو الانبوت الأصلي ديال Appointment For

    elements.forEach(node => {
      const cs = getComputedStyle(node);
      if (cs.display === "none") return;
      const label  = node.querySelector("label");
      const select = node.querySelector("span.k-select");
      if (!label || !select) return;

      const labelText = (label.textContent || "").trim();
      const labelId   = label.getAttribute("for");
      if (!labelId) return;

      if (labelText.includes("Category")) {
        categoryId = labelId;
      } else if (labelText.includes("Location")) {
        locationId = labelId;
      } else if (labelText.includes("Visa Type")) {
        visaTypeId = labelId;
      } else if (labelText.includes("Visa Sub Type")) {
        visaSubTypeId = labelId;
      } else if (labelText.toLowerCase().includes("appointment for")) {
        // ✅ نفس الطريقة ديال لوكيشن/كاتيغوري ولكن لـ "Appointment For"
        appointmentForId = labelId;
      }
    });

    const out = { locationId, visaTypeId, visaSubTypeId, categoryId, appointmentForId };
    log("visible field inputs:", out);
    return out;
  }

  function findMembersFieldInput(form) {
    const elements = form.querySelectorAll(".mb-3");
    let membersId = null;
    elements.forEach(node => {
      const cs = getComputedStyle(node);
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
    if (membersId) log("[VT] Number Of Members field id:", membersId);
    return membersId;
  }

  function forceValueIntoField(id, value) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) { warn("forceValueIntoField: not found", id); return; }

    let usedKendo = false;
    const $el = window.jQuery ? window.jQuery(el) : null;

    if ($el && $el.data && $el.data("kendoDropDownList")) {
      const ddl = $el.data("kendoDropDownList");
      try {
        ddl.value(String(value));
        ddl.trigger("change");
        usedKendo = true;
      } catch (e) {
        warn("kendoDropDownList.value error", id, e);
      }
    } else {
      el.value = String(value);
    }

    log("[VT] INJECT", { elementId: id, injectedValue: String(value), kendo: usedKendo });
  }

  async function applyMembersField(form) {
    const membersCount = await loadMembersCount();
    if (!membersCount || membersCount < 2) {
      log("[VT] membersCount < 2 → skip");
      return;
    }

    const applicants = getApplicantsNoData();
    if (!applicants.length) { warn("[VT] applicantsNoData empty"); return; }

    const label = membersCount + " Members";
    const item = applicants.find(x => String(x.Name || "").toLowerCase() === label.toLowerCase());
    if (!item) { warn("[VT] no applicantsNoData match for", label); return; }

    const value = item.Id || item.Value;
    if (!value) { warn("[VT] applicantsNoData match has no Id/Value"); return; }

    const membersId = findMembersFieldInput(form);
    if (!membersId) { warn("[VT] members field id not found"); return; }

    forceValueIntoField(membersId, value);
    log("[VT] members injected:", { membersId, value });
  }

  // ---------- 6) delay ----------
  function loadDelayMs() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) { resolve(0); return; }
      chrome.storage.local.get(
        ["calendria_use_delays", "calendria_delay_visatype"],
        (res = {}) => {
          const master = res.calendria_use_delays === "on";
          if (!master) { log("[VT] delay master OFF"); resolve(0); return; }
          let raw = (res.calendria_delay_visatype || "").toString().trim().replace(",", ".");
          let sec = parseFloat(raw);
          if (!isFinite(sec) || sec < 0) sec = 0;
          const ms = Math.round(sec * 1000);
          log("[VT] delay =", ms, "ms");
          resolve(ms);
        }
      );
    });
  }

  // ---------- 7) submittedData map ----------
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
        out.push({ name: mm[1], id: mm[2] });
      }
      if (out.length) {
        log("[VT] submittedData map len=", out.length);
        return out;
      }
    }
    warn("[VT] submittedData map not found");
    return [];
  }

  // ✅ نفس منطق الموقع
  function buildResponseDataObject(form) {
    const map = parseSubmittedDataSpec();
    const obj = {};
    if (!map.length) {
      log("[VT] ResponseData empty (no map)");
      return obj;
    }
    for (let i = 0; i < map.length && i < 50; i++) {
      const { name, id } = map[i];
      const el = document.getElementById(id);
      obj[name] = el && el.value != null ? String(el.value) : "";
    }
    log("[VT] ResponseData:", obj);
    return obj;
  }

  // ---------- 8) AppointmentFor ----------
  function readAppointmentForFromDom(form) {
    const hidden = form.querySelector('[name="AppointmentFor"]');
    if (hidden && hidden.value) return String(hidden.value).trim();

    const famVal = form.querySelector('input[type="radio"][value="Family"]:checked');
    const indVal = form.querySelector('input[type="radio"][value="Individual"]:checked');
    if (famVal) return "Family";
    if (indVal) return "Individual";

    const famId = form.querySelector('input[type="radio"][id^="family"]:checked');
    const selfId = form.querySelector('input[type="radio"][id^="self"]:checked');
    if (famId) return "Family";
    if (selfId) return "Individual";

    return "";
  }

  function getAppointmentForValue(form) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve(readAppointmentForFromDom(form));
        return;
      }
      chrome.storage.local.get(["calendria_appointment_for"], (res = {}) => {
        const raw = (res.calendria_appointment_for || "").toString().trim().toLowerCase();
        if (raw === "family")           resolve("Family");
        else if (raw === "individual")  resolve("Individual");
        else                            resolve(readAppointmentForFromDom(form));
      });
    });
  }

  // 🆕 نحدّد الانبت الأصلي ديال Appointment For بنفس منطق .mb-3 + label
  function findAppointmentForInputId(form) {
    const blocks = form.querySelectorAll(".mb-3");
    for (const node of blocks) {
      const cs = getComputedStyle(node);
      if (cs.display === "none") continue;
      const label = node.querySelector("label");
      if (!label) continue;
      const txt = (label.textContent || "").toLowerCase();
      const labelId = label.getAttribute("for");
      if (!labelId) continue;
      if (txt.includes("appointment for")) {
        log("[VT] AppointmentFor base input id (via .mb-3):", labelId);
        return labelId;
      }
    }
    warn("[VT] AppointmentFor base input id not found via .mb-3");
    return null;
  }

  // نضبط الراديو في الواجهة + الانبت الأصلي
  function syncAppointmentFor(form, apptForVal, baseIdFromFields) {
    if (!apptForVal) return;

    // 1) الراديو اللي عندو value مناسبة
    const radio = form.querySelector('input[type="radio"][value="' + apptForVal + '"]');
    if (radio) {
      const name = radio.name;
      if (name) {
        const group = form.querySelectorAll('input[type="radio"][name="' + name + '"]');
        group.forEach(r => { r.checked = (r === radio); });
      } else {
        radio.checked = true;
      }
    }

    // 2) الانبت الأصلي (hidden/text) داخل بلوك "Appointment For"
    const baseId = baseIdFromFields || findAppointmentForInputId(form);
    if (baseId) {
      const baseEl = document.getElementById(baseId);
      if (baseEl) {
        baseEl.value = apptForVal;
        log("[VT] set AppointmentFor base #" + baseId + " =", apptForVal);
      }
    }
  }

  // ---------- 9) POST ----------
  async function buildPayloadAndSend(form) {
    if (window.__cal_vt_sent) {
      warn("already sent once, skipping");
      return;
    }
    window.__cal_vt_sent = true;

    const respObj   = buildResponseDataObject(form);
    const respInput = form.querySelector('[name="ResponseData"]');
    if (respInput) respInput.value = JSON.stringify(respObj);

    const dataInput  = form.querySelector('[name="Data"]');
    const dsInput    = form.querySelector('[name="DataSource"]');
    const tokenInput = form.querySelector('[name="__RequestVerificationToken"]');
    const recInput   = form.querySelector('[name="ReCaptchaToken"]');

    const dataVal  = dataInput  ? dataInput.value  : "";
    const dsVal    = dsInput    ? dsInput.value    : "WEB_BLS";
    const tokenVal = tokenInput ? tokenInput.value : "";
    const recVal   = recInput   ? recInput.value   : "";

    const fd = new FormData(form);

    // لا نمس AppointmentFor هنا
    fd.set("Data", dataVal);
    fd.set("DataSource", dsVal);
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
    log("[VT] waiting", delayMs, "ms before POST...");

    setTimeout(async () => {
      const url = "/MAR/Appointment/VisaType";
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1"
      };
      try {
        log("[VT] sending POST to", url);
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: params.toString(),
          credentials: "include",
          redirect: "manual",
        });
        log("[VT] POST status:", resp.status);

        const qs = new URLSearchParams(location.search || "");
        const dataFromUrl = qs.get("data") || "";
        const slotData = dataVal || dataFromUrl;
        if (!slotData) { warn("[VT] no Data token to go SlotSelection"); return; }

        if (chrome?.storage?.local) {
          chrome.storage.local.get(["calendria_location_name"], (res = {}) => {
            const rawLoc   = (res.calendria_location_name || "").toString().trim();
            const locUpper = rawLoc.toUpperCase();
            const slotUrl =
              "/MAR/Appointment/SlotSelection?data=" +
              encodeURIComponent(slotData) +
              (locUpper ? "&loc=" + encodeURIComponent(locUpper) : "");
            log("[VT] redirect →", slotUrl);
            location.href = slotUrl;
          });
        } else {
          const slotUrl =
            "/MAR/Appointment/SlotSelection?data=" +
            encodeURIComponent(slotData);
          log("[VT] redirect →", slotUrl);
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
    if (!form) { warn("no form found"); return; }

    form.addEventListener("submit", e => {
      e.preventDefault();
      warn("native form submit intercepted");
    });

    const arrays  = getPageArrays();
    const choices = await loadPopupChoices();

    if (!choices.locName && !choices.vsName && !choices.vsSubName && !choices.catName) {
      warn("choices empty → nothing to do");
      return;
    }

    const ids = resolveIds(arrays, choices);
    if (!ids.locationId || !ids.visaTypeId || !ids.visaSubTypeId || !ids.categoryId) {
      warn("missing IDs, abort");
      return;
    }

    const fields = findVisibleFieldInputs(form);
    if (fields.locationId)    forceValueIntoField(fields.locationId,    ids.locationId);
    if (fields.visaTypeId)    forceValueIntoField(fields.visaTypeId,    ids.visaTypeId);
    if (fields.visaSubTypeId) forceValueIntoField(fields.visaSubTypeId, ids.visaSubTypeId);
    if (fields.categoryId)    forceValueIntoField(fields.categoryId,    ids.categoryId);

    const apptForVal = await getAppointmentForValue(form);

    // ✅ الآن نستعمل نفس system ديال الحقول باش نحط "Family" أو "Individual"
    syncAppointmentFor(form, apptForVal, fields.appointmentForId);

    // نعطي شوية وقت بسيط باش أي logic داخلي يكمل، ثم نحقن members
    await new Promise(r => setTimeout(r, 150));
    await applyMembersField(form);

    await buildPayloadAndSend(form);
    log("[VT] done (fields + AppointmentFor + members + POST scheduled)");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(main, 300);
  } else {
    document.addEventListener("DOMContentLoaded", () => setTimeout(main, 300));
  }
})();
