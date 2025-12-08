// SAMURAI/functions/signal.js

// تخزين بسيط في الذاكرة
const state = {};

// ===== CORS Helpers =====
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // تقدر تحدد origin ديالك إلا بغيتي
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

// Preflight (OPTIONS) للـ POST من الإضافة / EXE
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function ensureCategory(cat) {
  if (!state[cat]) {
    state[cat] = {
      first: null,
      second: null,
    };
  }
  return state[cat];
}

// POST /signal  <-- من SAMURAI_SIGNAL (Python)
export async function onRequestPost({ request }) {
  try {
    const data = await request.json();
    const cat   = data.category || "UNKNOWN";
    const which = data.which || "unknown"; // "first" أو "second"
    const secs  = data.seconds;
    const label = data.label;

    const bucket = ensureCategory(cat);

    if (which === "first") {
      bucket.first = {
        seconds: secs,
        label,
        updatedAt: new Date().toISOString(),
      };
    } else if (which === "second") {
      bucket.second = {
        seconds: secs,
        label,
        updatedAt: new Date().toISOString(),
      };
    }

    return jsonResponse({ ok: true, category: cat, which, current: bucket }, 200);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 400);
  }
}

// GET /signal  <-- من الإضافة (slot-blank.js)
export async function onRequestGet() {
  return jsonResponse({ ok: true, state }, 200);
}
