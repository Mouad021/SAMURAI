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

// preflight
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

const KV_KEY = "samurai-signal-state";

// helper: read state from KV
async function loadState(env) {
  try {
    const txt = await env.SIGNAL_KV.get(KV_KEY);
    if (!txt) return {};
    return JSON.parse(txt);
  } catch (e) {
    return {};
  }
}

// helper: save state to KV (مع صلاحية 60 ثانية)
async function saveState(env, state) {
  try {
    await env.SIGNAL_KV.put(KV_KEY, JSON.stringify(state), {
      expirationTtl: 60, // seconds
    });
  } catch (e) {
    // silent
  }
}

function ensureCategory(state, cat) {
  if (!state[cat]) {
    state[cat] = {
      first: null,
      second: null,
    };
  }
  return state[cat];
}

// POST /signal  <-- من EXE
export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();
    const cat   = data.category || "UNKNOWN";
    const which = data.which || "unknown";
    const secs  = data.seconds;
    const label = data.label;

    let state = await loadState(env);
    const bucket = ensureCategory(state, cat);

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

    await saveState(env, state);

    return jsonResponse({ ok: true, category: cat, which, current: bucket }, 200);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 400);
  }
}

// GET /signal  <-- من الإضافة
export async function onRequestGet({ env }) {
  const state = await loadState(env);
  return jsonResponse({ ok: true, state }, 200);
}
