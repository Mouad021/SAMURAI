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

// ===== تخزين بسيط: KV إذا كانت مربوطة، وإلا fallback في الذاكرة =====
const KV_KEY = "samurai-signal-once";

let fallbackState = {}; // { REGROUP: { label, seconds, createdAt } }

async function loadState(env) {
  try {
    if (!env || !env.SIGNAL_KV) {
      return fallbackState || {};
    }
    const txt = await env.SIGNAL_KV.get(KV_KEY);
    if (!txt) return {};
    return JSON.parse(txt);
  } catch (e) {
    return fallbackState || {};
  }
}

async function saveState(env, state) {
  fallbackState = state;
  try {
    if (!env || !env.SIGNAL_KV) return;
    await env.SIGNAL_KV.put(KV_KEY, JSON.stringify(state), {
      expirationTtl: 30, // 30 ثانية كحد أقصى
    });
  } catch (e) {
    // نطنّش الأخطاء ديال KV
  }
}

// POST /signal  من EXE
export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    const cat   = data.category || "UNKNOWN";
    const secs  = data.seconds;
    const label = data.label;

    let state = await loadState(env);
    state[cat] = {
      seconds: secs,
      label,
      createdAt: new Date().toISOString(),
    };

    await saveState(env, state);

    return jsonResponse({ ok: true, category: cat }, 200);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 400);
  }
}

// GET /signal  من الإضافة
// ترجع كل الإشارات الحالية، وبعدها تفرّغ الصندوق (تخليه {})
export async function onRequestGet({ env }) {
  const state = await loadState(env);
  // نرجع الإشارات
  const body = { ok: true, state };
  // نفرغ بعد الإرسال
  await saveState(env, {});
  return jsonResponse(body, 200);
}
