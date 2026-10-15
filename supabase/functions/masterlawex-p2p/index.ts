import { createClient } from "npm:@supabase/supabase-js@2";
import { getAddress, verifyMessage } from "npm:ethers@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const USDC = "0x3600000000000000000000000000000000000000";
const DOMAIN = "arcx-exchange.vercel.app";
const PRIMARY_ORIGIN = "https://arcx-exchange.vercel.app";

function originAllowed(origin: string) {
  if (!origin) return true;
  if (origin === PRIMARY_ORIGIN) return true;
  if (origin === "https://arcx-exchange-v2-masterslawchile-4307s-projects.vercel.app") return true;
  if (origin === "https://arcx-exchange-v2-git-main-masterslawchile-4307s-projects.vercel.app") return true;
  return origin.startsWith("https://arcx-exchange-v2-") &&
    origin.endsWith("-masterslawchile-4307s-projects.vercel.app");
}
function corsFor(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) && origin ? origin : PRIMARY_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
function walletOf(v: unknown) {
  try { return getAddress(String(v || "")).toLowerCase(); } catch { return null; }
}
function randHex(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function safeName(v: unknown) {
  const s = String(v || "").trim().replace(/[^\p{L}\p{N} ._\-]/gu, "").slice(0, 40);
  return s || null;
}
async function auth(req: Request) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length < 32) return null;
  const token_hash = await sha256(token);
  const now = new Date().toISOString();
  const { data: session } = await db.from("ml_ex_sessions")
    .select("wallet,expires_at")
    .eq("token_hash", token_hash)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (!session) return null;
  return { token, wallet: String(session.wallet).toLowerCase() };
}
async function profile(wallet: string) {
  const { data } = await db.from("ml_ex_p2p_profiles")
    .select("wallet,display_name,status,kyc_level,completed_trades,disputed_trades,reputation,created_at")
    .eq("wallet", wallet).maybeSingle();
  return data;
}
async function event(agent_key: string, severity: string, event_type: string, subject_type: string | null, subject_id: string | null, decision: string, score: number | null, details: Record<string, unknown> = {}) {
  await db.from("ml_ex_agent_events").insert({ agent_key, severity, event_type, subject_type, subject_id, decision, score, details });
  await db.from("ml_ex_agent_state")
    .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("agent_key", agent_key);
}
function riskScore(p: any, amount: number) {
  let score = 5;
  if (!p || Number(p.completed_trades || 0) === 0) score += 18;
  if (Number(p?.kyc_level || 0) === 0) score += 20;
  if (Number(p?.disputed_trades || 0) > 0) score += Math.min(25, Number(p.disputed_trades) * 8);
  if (Number(p?.reputation || 100) < 85) score += 15;
  if (amount > 1000) score += 10;
  if (amount > 5000) score += 15;
  return Math.max(0, Math.min(100, score));
}
function transitionError(message: string) {
  if (message.includes("trade_not_found")) return ["trade_not_found", 404] as const;
  if (message.includes("unauthorized")) return ["forbidden", 403] as const;
  if (message.includes("deadline_passed")) return ["trade_expired", 409] as const;
  if (message.includes("invalid_transition")) return ["invalid_transition", 409] as const;
  return ["transition_failed", 409] as const;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
  const fail = (message: string, status = 400) => json({ ok: false, error: message }, status);

  const requestOrigin = req.headers.get("origin") || "";
  if (requestOrigin && !originAllowed(requestOrigin)) return fail("origin_not_allowed", 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 32768) return fail("payload_too_large", 413);

  let body: any = {};
  try { body = await req.json(); } catch { return fail("invalid_json"); }
  const action = String(body.action || "");

  try {
    if (action === "challenge") {
      const wallet = walletOf(body.wallet);
      if (!wallet) return fail("invalid_wallet");
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { count } = await db.from("ml_ex_auth_challenges")
        .select("id", { count: "exact", head: true })
        .eq("wallet", wallet)
        .gte("created_at", since);
      if ((count || 0) >= 10) return fail("rate_limited", 429);

      const nonce = randHex(18);
      const issued = new Date();
      const expires = new Date(issued.getTime() + 5 * 60_000);
      const message = [
        "MasterlawEX Login",
        `Wallet: ${wallet}`,
        `Nonce: ${nonce}`,
        `Domain: ${DOMAIN}`,
        `Issued At: ${issued.toISOString()}`,
        `Expires At: ${expires.toISOString()}`,
        "Purpose: Sign in to MasterlawEX P2P Testnet.",
        "This signature does NOT authorize any transfer of funds."
      ].join("\n");
      const { data, error } = await db.from("ml_ex_auth_challenges")
        .insert({ wallet, nonce, message, expires_at: expires.toISOString() })
        .select("id").single();
      if (error) throw error;
      return json({ ok: true, challenge_id: data.id, message, expires_at: expires.toISOString() });
    }

    if (action === "login") {
      const id = String(body.challenge_id || "");
      const signature = String(body.signature || "");
      if (!id || !signature) return fail("missing_signature");
      const { data: ch } = await db.from("ml_ex_auth_challenges")
        .select("id,wallet,message,expires_at,used_at").eq("id", id).maybeSingle();
      if (!ch || ch.used_at || new Date(ch.expires_at).getTime() < Date.now()) return fail("challenge_expired", 401);

      let recovered = "";
      try { recovered = verifyMessage(ch.message, signature).toLowerCase(); }
      catch { return fail("invalid_signature", 401); }
      if (recovered !== String(ch.wallet).toLowerCase()) return fail("signature_wallet_mismatch", 401);

      const now = new Date().toISOString();
      const { data: consumed, error: consumeError } = await db.from("ml_ex_auth_challenges")
        .update({ used_at: now })
        .eq("id", id)
        .is("used_at", null)
        .gt("expires_at", now)
        .select("id")
        .maybeSingle();
      if (consumeError) throw consumeError;
      if (!consumed) return fail("challenge_already_used", 401);

      const wallet = String(ch.wallet).toLowerCase();
      await db.from("ml_ex_p2p_profiles").upsert({ wallet }, { onConflict: "wallet", ignoreDuplicates: true });
      const token = randHex(32);
      const token_hash = await sha256(token);
      const expires = new Date(Date.now() + 12 * 60 * 60_000).toISOString();
      const { error } = await db.from("ml_ex_sessions").insert({ wallet, token_hash, expires_at: expires });
      if (error) throw error;
      await event("guardian", "info", "wallet_login", "wallet", wallet, "session_granted", 0, { domain: DOMAIN });
      return json({ ok: true, token, wallet, expires_at: expires, profile: await profile(wallet) });
    }

    if (action === "logout") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      await db.from("ml_ex_sessions").update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", await sha256(a.token));
      return json({ ok: true });
    }

    if (action === "offers") {
      const { data: offers, error } = await db.from("ml_ex_p2p_offers")
        .select("id,maker_wallet,side,asset_symbol,fiat_currency,price,available_amount,min_amount,max_amount,payment_method,status,risk_score,created_at")
        .eq("status", "active").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const wallets = [...new Set((offers || []).map((x: any) => x.maker_wallet))];
      const pmap: Record<string, any> = {};
      if (wallets.length) {
        const { data: ps } = await db.from("ml_ex_p2p_profiles")
          .select("wallet,display_name,status,kyc_level,completed_trades,reputation").in("wallet", wallets);
        for (const p of ps || []) pmap[p.wallet] = p;
      }
      return json({ ok: true, mode: "testnet_pre_escrow", offers: (offers || []).map((o: any) => ({ ...o, maker: pmap[o.maker_wallet] || null })) });
    }

    if (action === "me") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      return json({ ok: true, profile: await profile(a.wallet) });
    }

    if (action === "set_profile") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const display_name = safeName(body.display_name);
      if (!display_name || display_name.length < 3) return fail("invalid_display_name");
      await db.from("ml_ex_p2p_profiles").update({ display_name, updated_at: new Date().toISOString() }).eq("wallet", a.wallet);
      return json({ ok: true, profile: await profile(a.wallet) });
    }

    if (action === "create_offer") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const p = await profile(a.wallet);
      if (!p || p.status === "blocked") return fail("profile_blocked", 403);
      const side = String(body.side || "sell");
      if (side !== "sell") return fail("only_sell_offers_enabled_in_sandbox");
      const fiat = String(body.fiat_currency || "").toUpperCase();
      if (!["CLP","ARS","USD","EUR","BRL","MXN"].includes(fiat)) return fail("unsupported_fiat");
      const price = Number(body.price), available = Number(body.available_amount), min = Number(body.min_amount), max = Number(body.max_amount);
      if (![price, available, min, max].every(Number.isFinite) || price <= 0 || available <= 0 || min <= 0 || max < min || max > available) return fail("invalid_amounts");
      if (available > 100000) return fail("sandbox_limit_exceeded");
      const payment = String(body.payment_method || "").toUpperCase();
      const allowedPayments = ["BANK_TRANSFER","MERCADO_PAGO","TRANSFER_24_7","OTHER_VERIFIED"];
      if (!allowedPayments.includes(payment)) return fail("unsupported_payment_method");

      const score = riskScore(p, available);
      const status = score >= 65 ? "review" : "active";
      const { data, error } = await db.from("ml_ex_p2p_offers")
        .insert({ maker_wallet: a.wallet, side, asset_address: USDC, asset_symbol: "USDC", fiat_currency: fiat, price, available_amount: available, min_amount: min, max_amount: max, payment_method: payment, status, risk_score: score })
        .select("id,status,risk_score").single();
      if (error) throw error;
      await event("p2p_risk", score >= 65 ? "warn" : "info", "offer_screened", "offer", data.id, status === "review" ? "hold_for_review" : "allow_sandbox", score, { fiat, payment_method: payment, sandbox: true });
      if (score >= 65) await event("compliance", "warn", "offer_compliance_review", "offer", data.id, "manual_review_required", score, { sandbox: true });
      return json({ ok: true, ...data, mode: "testnet_pre_escrow" });
    }

    if (action === "take_offer") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return fail("invalid_amount");
      const p = await profile(a.wallet);
      const score = riskScore(p, amount);
      if (score >= 80) {
        await event("guardian", "warn", "trade_blocked", "offer", String(body.offer_id || ""), "risk_block", score, { sandbox: true });
        return fail("risk_review_required", 403);
      }
      const { data, error } = await db.rpc("ml_ex_p2p_take_offer", { p_offer: String(body.offer_id || ""), p_buyer: a.wallet, p_amount: amount });
      if (error) {
        if (error.message.includes("self_trade")) return fail("self_trade", 409);
        if (error.message.includes("amount_out_of_range")) return fail("amount_out_of_range", 409);
        return fail("offer_unavailable", 409);
      }
      await event("p2p_risk", score >= 60 ? "warn" : "info", "trade_reserved", "trade", String(data), score >= 60 ? "enhanced_monitoring" : "allow_sandbox", score, { sandbox: true });
      return json({ ok: true, trade_id: data, mode: "testnet_pre_escrow" });
    }

    if (action === "my_trades") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const { data, error } = await db.from("ml_ex_p2p_trades")
        .select("id,offer_id,buyer_wallet,seller_wallet,crypto_amount,fiat_amount,fiat_currency,status,deadline,risk_score,created_at,updated_at")
        .or(`buyer_wallet.eq.${a.wallet},seller_wallet.eq.${a.wallet}`)
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ ok: true, trades: data || [], wallet: a.wallet });
    }

    if (action === "mark_paid" || action === "release" || action === "dispute") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const id = String(body.trade_id || "");
      if (!id) return fail("trade_not_found", 404);

      const rpcAction = action === "mark_paid" ? "mark_paid" : action === "release" ? "release" : "dispute";
      const { data: result, error } = await db.rpc("ml_ex_p2p_transition", {
        p_trade: id,
        p_requester: a.wallet,
        p_action: rpcAction,
        p_reason: action === "dispute" ? String(body.reason_category || "OTHER").slice(0, 40) : null,
        p_description: action === "dispute" ? String(body.description || "").slice(0, 1000) : null
      });
      if (error) {
        const [message, status] = transitionError(error.message || "");
        return fail(message, status);
      }

      const { data: t } = await db.from("ml_ex_p2p_trades")
        .select("buyer_wallet,seller_wallet,risk_score,status").eq("id", id).maybeSingle();
      if (action === "mark_paid") {
        await event("guardian", "info", "payment_marked", "trade", id, "await_seller_confirmation", Number(t?.risk_score || 0), { sandbox: true, no_funds_moved: true });
      } else if (action === "release") {
        await event("guardian", "info", "sandbox_trade_completed", "trade", id, "completed_without_onchain_escrow", Number(t?.risk_score || 0), { sandbox: true, no_funds_moved: true });
      } else {
        const disputeId = String(result?.dispute_id || "");
        await event("dispute_copilot", "critical", "dispute_opened", "trade", id, "freeze_and_human_review", Math.max(70, Number(t?.risk_score || 0)), { dispute_id: disputeId, category: String(body.reason_category || "OTHER").slice(0, 40), sandbox: true });
      }
      return json({ ok: true, ...(result || {}) });
    }

    if (action === "cancel") {
      const a = await auth(req); if (!a) return fail("unauthorized", 401);
      const id = String(body.trade_id || "");
      const { data: t } = await db.from("ml_ex_p2p_trades").select("risk_score").eq("id", id).maybeSingle();
      const { error } = await db.rpc("ml_ex_p2p_cancel_reserved", { p_trade: id, p_requester: a.wallet });
      if (error) return fail("trade_not_cancellable", 409);
      await event("p2p_risk", "info", "trade_cancelled", "trade", id, "cancelled", Number(t?.risk_score || 0), { sandbox: true });
      return json({ ok: true });
    }

    if (action === "agent_status") {
      const { data: agents } = await db.from("ml_ex_agent_state")
        .select("agent_key,label,mode,active,authority,last_run_at,updated_at").order("agent_key");
      const { data: ev } = await db.from("ml_ex_agent_events")
        .select("id,agent_key,severity,event_type,subject_type,decision,score,created_at")
        .order("created_at", { ascending: false }).limit(40);
      return json({
        ok: true,
        agents: agents || [],
        events: ev || [],
        policy: {
          privileged_fund_actions: "disabled",
          dispute_resolution: "human_required",
          treasury: "multisig_required",
          backend_transition_locking: "atomic_v2"
        }
      });
    }

    return fail("unknown_action", 404);
  } catch (e) {
    console.error(e);
    return fail("server_error", 500);
  }
});
