'use strict';

const FRONTEND_RELEASE_URL = process.env.MASTERLAWEX_FRONTEND_RELEASE_URL || 'https://arcx-exchange-v2.vercel.app/release.json';
const API_HEALTH_URL = process.env.MASTERLAWEX_API_HEALTH_URL || 'https://masterlaw-api.vercel.app/api/exchange/p2p/health';
const FRONTEND_REPO = process.env.MASTERLAWEX_FRONTEND_REPO || 'Masterlawcoin/COIN';
const API_REPO = process.env.MASTERLAWEX_API_REPO || 'Masterlawcoin/masterlaw-api';
const EXPECTED_CHAIN_ID = 5042002;
const EXPECTED_USDC = '0x3600000000000000000000000000000000000000';
const SOFT = process.argv.includes('--soft') || process.env.PRODUCTION_SMOKE_SOFT === '1';

function same(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function shortSha(value) {
  const sha = String(value || '');
  return sha ? sha.slice(0, 12) : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PRODUCTION_SMOKE_TIMEOUT_MS || 12000));
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        'user-agent': 'MasterlawEX-production-smoke/1.0',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, json, text: text.slice(0, 500) };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function githubMainSha(repo) {
  const explicit = repo === FRONTEND_REPO ? process.env.EXPECTED_FRONTEND_SHA : process.env.EXPECTED_API_SHA;
  if (explicit) return explicit.trim();
  const headers = {};
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const result = await fetchJson(`https://api.github.com/repos/${repo}/commits/main`, { headers });
  if (!result.ok || !result.json?.sha) throw new Error(`GITHUB_MAIN_SHA_UNAVAILABLE:${repo}:${result.status}`);
  return result.json.sha;
}

function validateFrontend(result, expectedSha) {
  const j = result.json;
  const checks = {
    http_200: result.status === 200,
    schema: j?.schema === 'MASTERLAWEX_RELEASE_V1',
    git_sha_matches_main: same(j?.git_sha, expectedSha),
    network_arc_testnet: j?.network === 'Arc Testnet',
    chain_id: Number(j?.chain_id) === EXPECTED_CHAIN_ID,
    canonical_usdc: same(j?.asset, EXPECTED_USDC),
    pre_real_money: j?.p2p_mode === 'PRE_REAL_MONEY',
    real_money_disabled: j?.real_money_enabled === false
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}

function validateApi(result, expectedSha) {
  const j = result.json;
  const release = j?.release;
  const checks = {
    http_200: result.status === 200,
    ok: j?.ok === true,
    service: j?.service === 'MASTERLAW_P2P_CONTROL_PLANE',
    release_schema: release?.schema === 'MASTERLAW_P2P_RELEASE_V1',
    git_sha_matches_main: same(release?.git_sha, expectedSha),
    chain_id: Number(j?.chain_id) === EXPECTED_CHAIN_ID && Number(release?.chain_id) === EXPECTED_CHAIN_ID,
    writes_disabled: j?.writes_enabled === false,
    real_money_disabled: j?.real_money_enabled === false && release?.real_money_enabled === false
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}

function statusFor(frontend, api) {
  if (frontend.pass && api.pass) return 'FRESH';
  const frontendMissing = !frontend.checks.http_200 || !frontend.checks.schema;
  const apiMissing = !api.checks.http_200 || !api.checks.release_schema;
  if (frontendMissing || apiMissing) return 'STALE';
  return 'BLOCKED';
}

async function main() {
  const [frontendMainSha, apiMainSha] = await Promise.all([
    githubMainSha(FRONTEND_REPO),
    githubMainSha(API_REPO)
  ]);

  const [frontendResult, apiResult] = await Promise.all([
    fetchJson(FRONTEND_RELEASE_URL, { headers: { 'cache-control': 'no-cache' } }),
    fetchJson(API_HEALTH_URL, { headers: { 'cache-control': 'no-cache' } })
  ]);

  const frontend = validateFrontend(frontendResult, frontendMainSha);
  const api = validateApi(apiResult, apiMainSha);
  const status = statusFor(frontend, api);

  const report = {
    schema: 'MASTERLAWEX_PRODUCTION_SMOKE_V1',
    checked_at: new Date().toISOString(),
    mode: 'READ_ONLY',
    production_status: status,
    real_money_expected: false,
    expected: {
      frontend_main_sha: frontendMainSha,
      api_main_sha: apiMainSha,
      chain_id: EXPECTED_CHAIN_ID,
      asset: EXPECTED_USDC
    },
    frontend: {
      url: FRONTEND_RELEASE_URL,
      http_status: frontendResult.status,
      deployed_sha: frontendResult.json?.git_sha || null,
      deployed_sha_short: shortSha(frontendResult.json?.git_sha),
      expected_sha_short: shortSha(frontendMainSha),
      ...frontend
    },
    api: {
      url: API_HEALTH_URL,
      http_status: apiResult.status,
      deployed_sha: apiResult.json?.release?.git_sha || null,
      deployed_sha_short: shortSha(apiResult.json?.release?.git_sha),
      expected_sha_short: shortSha(apiMainSha),
      version: apiResult.json?.version || null,
      ...api
    },
    mutations_performed: false,
    deployment_triggered: false,
    supabase_touched: false
  };

  console.log(JSON.stringify(report, null, 2));
  if (status !== 'FRESH' && !SOFT) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    schema: 'MASTERLAWEX_PRODUCTION_SMOKE_V1',
    production_status: 'ERROR',
    error: String(error?.message || error),
    mutations_performed: false,
    deployment_triggered: false,
    supabase_touched: false
  }, null, 2));
  if (!SOFT) process.exitCode = 3;
});
