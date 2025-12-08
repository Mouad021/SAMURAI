// SAMURAI/functions/signal.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
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

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ===== صندوق بسيط فـ global memory =====
// ماشي KV، غير object مشترك بين POST و GET داخل نفس الـ worker
function getState() {
  if (!globalThis.__SAMURAI_SIGNAL_STATE) {
    globalThis.__SAMURAI_SIGNAL_STATE = {};
  }
  return globalThis.__SAMURAI_SIGNAL_STATE;
}

function setState(newState) {
  globalThis.__SAMURAI_SIGNAL_STATE = newState || {};
}

// POST /signal  (من EXE)
export async function onRequestPost({ request }) {
  try {
    const data  = await request.json();
    const cat   = data.category || "UNKNOWN";
    const secs  = data.seconds;
    const label = data.label;

    const state = getState();
    state[cat] = {
      seconds: secs,
      label,
      createdAt: new Date().toISOString(),
    };
    setState(state);

    return jsonResponse({ ok: true, category: cat }, 200);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 400);
  }
}

// GET /signal  (من الإضافة)
// ترجع الإشارات الحالية ثم تفرّغ الصندوق
export async function onRequestGet() {
  const state = getState();
  const copy  = { ...state };   // نرجع نسخة
  setState({});                 // نفرّغ مباشرة بعد الإرسال
  return jsonResponse({ ok: true, state: copy }, 200);
}
