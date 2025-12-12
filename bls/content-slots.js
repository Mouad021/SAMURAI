(() => {
  "use strict";

  // فقط SlotSelection
  if (!/\/mar\/appointment\/slotselection/i.test(location.pathname)) return;
  if (window.__cal_slot_auto_final) return;
  window.__cal_slot_auto_final = true;

  const log = (...a) => console.log("%c[SLOT-AUTO]", "color:#0ff;font-weight:bold;", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitForJqKendo(max = 20000) {
    const t = Date.now();
    while (Date.now() - t < max) {
      if (window.jQuery && window.kendo) return true;
      await sleep(80);
    }
    return false;
  }

  function getAvailableDays() {
    const ad = window.availDates?.ad;
    if (!Array.isArray(ad)) return [];
    return ad.filter(d =>
      d &&
      d.DateText &&
      (d.SingleSlotAvailable === true || d.SingleSlotAvailable === "true") &&
      (d.AppointmentDateType === 0 || d.AppointmentDateType === "0")
    );
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function findDatePicker() {
    const $ = window.jQuery;
    const inp = document.querySelector('input[data-role="datepicker"]');
    if (!inp) return null;
    const dp = $(inp).data("kendoDatePicker");
    if (!dp) return null;
    return { inp, dp };
  }

  function setDate(dp, inp, dateText) {
    const [y, m, d] = dateText.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dp.value(dt);
    dp.trigger("change");
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    log("Date selected:", dateText);
  }

  function findSlotDDL() {
    const $ = window.jQuery;
    const inp = document.querySelector('input[data-role="dropdownlist"]');
    if (!inp) return null;
    const ddl = $(inp).data("kendoDropDownList");
    if (!ddl) return null;
    return ddl;
  }

  async function waitForSlots(ddl, max = 20000) {
    const t = Date.now();
    while (Date.now() - t < max) {
      const data = ddl.dataSource?.data();
      if (data && data.length) return data.toJSON ? data.toJSON() : [...data];
      await sleep(120);
    }
    return null;
  }

  function selectBestSlot(ddl, items) {
    const valid = items.filter(x => Number(x.Count) > 0);
    if (!valid.length) return false;

    valid.sort((a, b) => b.Count - a.Count);
    const best = valid[0];

    const data = ddl.dataSource.data();
    const index = data.findIndex(x => String(x.Id) === String(best.Id));
    if (index < 0) return false;

    // ✅ هذا هو المفتاح
    ddl.select(index);      // يحدث k-input
    ddl.value(best.Id);     // يحدث input الحقيقي
    ddl.trigger("change");  // يشعل منطق الموقع

    log("Slot selected:", best.Name, "Count:", best.Count);
    return true;
  }

  (async () => {
    if (!(await waitForJqKendo()))) return;

    const days = getAvailableDays();
    if (!days.length) return log("No available days");

    const day = pickRandom(days);
    log("Picked day:", day.DateText);

    const dpObj = findDatePicker();
    if (!dpObj) return log("DatePicker not found");

    setDate(dpObj.dp, dpObj.inp, day.DateText);

    const ddl = findSlotDDL();
    if (!ddl) return log("Slot DDL not found");

    const slots = await waitForSlots(ddl);
    if (!slots) return log("Slots not loaded");

    selectBestSlot(ddl, slots);
  })();

})();
