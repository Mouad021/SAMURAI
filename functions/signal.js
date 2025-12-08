// SAMURAI/functions/signal.js

// تخزين بسيط في الذاكرة (لكل instance ديال ال-worker)
// كيسجّل آخر توقيت FIRST / SECOND لكل كاتيجوري
const state = {};

// Helper صغير باش نضمنو وجود الكاتيجوري
function ensureCategory(cat) {
  if (!state[cat]) {
    state[cat] = {
      first: null,
      second: null,
    };
  }
  return state[cat];
}

// POST /signal  --> كيتلقى البيانات من سكريبت SAMURAI_SIGNAL
export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    const cat    = data.category || "UNKNOWN";
    const which  = data.which || "unknown";   // "first" أو "second"
    const secs   = data.seconds;
    const label  = data.label;

    const bucket = ensureCategory(cat);

    if (which === "first") {
      bucket.first = { seconds: secs, label, updatedAt: new Date().toISOString() };
    } else if (which === "second") {
      bucket.second = { seconds: secs, label, updatedAt: new Date().toISOString() };
    }

    // نرجع OK + الحالة الحالية ديال داك الكاتيجوري
    return new Response(
      JSON.stringify({ ok: true, category: cat, which, current: bucket }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// GET /signal  --> يرجع جميع الكاتيجوري/times (باش الإضافة تقدر تقراهم)
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, state }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
