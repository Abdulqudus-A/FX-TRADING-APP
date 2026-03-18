#!/usr/bin/env bash
# =============================================================================
# FX Trading App — Full Endpoint Test Script
# Run: chmod +x test-endpoints.sh && ./test-endpoints.sh
# Requires: curl, jq, psql (PostgreSQL client)
# =============================================================================

BASE="http://localhost:3000/api/v1"
DB_CMD="PGPASSWORD=k0l0 psql -U seamfix -d fx_trading -h localhost -qt"
PASS=0; FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────

green()  { echo -e "\033[32m✅  $*\033[0m"; }
red()    { echo -e "\033[31m❌  $*\033[0m"; }
blue()   { echo -e "\033[34m\n══ $* ══\033[0m"; }
yellow() { echo -e "\033[33m   $*\033[0m"; }

assert() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    green "$label"
    ((PASS++))
  else
    red "$label (expected: $expected)"
    yellow "Response: $actual"
    ((FAIL++))
  fi
}

post() { curl -s -X POST "$BASE$1" -H "Content-Type: application/json" -d "$2"; }
get()  { curl -s -X GET  "$BASE$1" -H "Authorization: Bearer $3" ${2:+-d "$2"}; }
patch(){ curl -s -X PATCH "$BASE$1" -H "Content-Type: application/json" -H "Authorization: Bearer $3" -d "$2"; }

# ── 0. preflight ─────────────────────────────────────────────────────────────

blue "0. PREFLIGHT"

APP_UP=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "$BASE/fx/rates")
if [ "$APP_UP" != "200" ]; then
  red "App is NOT running on port 3000 (got HTTP $APP_UP). Start it first:"
  yellow "  cd /Users/aabdulquduz/fx-trading-app && node dist/main.js &"
  yellow "  sleep 5 && ./test-endpoints.sh"
  exit 1
fi
green "App is up on port 3000"

# Clean test users from previous runs
eval "$DB_CMD" -c "DELETE FROM users WHERE email IN ('e2e_user@fxapp.dev','e2e_user2@fxapp.dev');" 2>/dev/null
green "Cleaned stale test users"

# ── 1. AUTH ──────────────────────────────────────────────────────────────────

blue "1. AUTH — Register"

R=$(post "/auth/register" '{"email":"e2e_user@fxapp.dev","password":"Test1234!","firstName":"E2E","lastName":"User"}')
assert "POST /auth/register → 201 success" '"success":true' "$R"

R_DUP=$(post "/auth/register" '{"email":"e2e_user@fxapp.dev","password":"Test1234!","firstName":"E2E","lastName":"User"}')
assert "POST /auth/register duplicate → 409" '"statusCode":409' "$R_DUP"

R_BAD=$(post "/auth/register" '{"email":"not-an-email","password":"short"}')
assert "POST /auth/register bad input → 400" '"statusCode":400' "$R_BAD"

blue "1. AUTH — OTP bypass (set isVerified=true in DB for e2e)"
eval "$DB_CMD" -c "UPDATE users SET \"isVerified\"=true WHERE email='e2e_user@fxapp.dev';" 2>/dev/null
green "Marked e2e_user as verified via DB"

blue "1. AUTH — Login"

R=$(post "/auth/login" '{"email":"e2e_user@fxapp.dev","password":"Test1234!"}')
assert "POST /auth/login valid → 200 + token" '"accessToken"' "$R"
USER_TOKEN=$(echo "$R" | jq -r '.data.accessToken // empty' 2>/dev/null)
if [ -z "$USER_TOKEN" ]; then
  red "Could not extract user token — skipping protected endpoint tests"
  exit 1
fi
yellow "User token: ${USER_TOKEN:0:40}..."

R_WRONG=$(post "/auth/login" '{"email":"e2e_user@fxapp.dev","password":"WrongPass!"}')
assert "POST /auth/login wrong password → 401" '"statusCode":401' "$R_WRONG"

R_UNVERIFIED=$(post "/auth/register" '{"email":"e2e_user2@fxapp.dev","password":"Test1234!","firstName":"E2E","lastName":"Two"}')
R_UNVERIFIED_LOGIN=$(post "/auth/login" '{"email":"e2e_user2@fxapp.dev","password":"Test1234!"}')
assert "POST /auth/login unverified → 403" '"statusCode":403' "$R_UNVERIFIED_LOGIN"

blue "1. AUTH — Resend OTP"
R=$(post "/auth/resend-otp" '{"email":"e2e_user2@fxapp.dev"}')
assert "POST /auth/resend-otp valid email → 200" '"success":true' "$R"

R=$(post "/auth/resend-otp" '{"email":"ghost@nowhere.com"}')
assert "POST /auth/resend-otp unknown email → 200 (anti-enum)" '"success":true' "$R"

# ── 2. ADMIN LOGIN ───────────────────────────────────────────────────────────

blue "2. ADMIN LOGIN"

ADMIN_EMAIL=$(grep SEED_ADMIN_EMAIL /Users/aabdulquduz/fx-trading-app/.env | cut -d= -f2)
ADMIN_PASS=$(grep SEED_ADMIN_PASSWORD /Users/aabdulquduz/fx-trading-app/.env | cut -d= -f2 | tr -d '\r')

R=$(post "/auth/login" "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
assert "Admin login → 200 + token" '"accessToken"' "$R"
ADMIN_TOKEN=$(echo "$R" | jq -r '.data.accessToken // empty' 2>/dev/null)
if [ -z "$ADMIN_TOKEN" ]; then
  red "Could not get admin token. Check SEED_ADMIN_EMAIL/PASSWORD in .env and run npm run seed:admin"
  yellow "Response: $R"
fi
yellow "Admin token: ${ADMIN_TOKEN:0:40}..."

# ── 3. FX RATES ──────────────────────────────────────────────────────────────

blue "3. FX RATES"

R=$(curl -s "$BASE/fx/rates")
assert "GET /fx/rates (public) → 200 + rates" '"baseCurrency":"NGN"' "$R"
assert "GET /fx/rates has USD" '"USD"' "$R"
assert "GET /fx/rates has EUR" '"EUR"' "$R"

# ── 4. WALLET ────────────────────────────────────────────────────────────────

blue "4. WALLET — Get balances"

R=$(curl -s "$BASE/wallet/balances" -H "Authorization: Bearer $USER_TOKEN")
assert "GET /wallet/balances → 200 + NGN balance" '"currency":"NGN"' "$R"

blue "4. WALLET — Fund (NGN only)"

R=$(curl -s -X POST "$BASE/wallet/fund" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"amount":100000,"idempotencyKey":"e2e-fund-001"}')
assert "POST /wallet/fund 100,000 NGN → 201" '"success":true' "$R"
assert "POST /wallet/fund shows new balance" '"newBalance"' "$R"

# Idempotency — same key should return same result, not double-credit
R_IDEM=$(curl -s -X POST "$BASE/wallet/fund" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"amount":100000,"idempotencyKey":"e2e-fund-001"}')
assert "POST /wallet/fund duplicate idempotencyKey → 200 (no double credit)" '"success":true' "$R_IDEM"

# Non-NGN funding should fail
R_FOREIGN=$(curl -s -X POST "$BASE/wallet/fund" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"amount":100,"currency":"USD","idempotencyKey":"e2e-fund-usd"}')
assert "POST /wallet/fund USD → 400 (NGN only)" '"statusCode":400' "$R_FOREIGN"

blue "4. WALLET — Convert (no spread)"

R=$(curl -s -X POST "$BASE/wallet/convert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"fromCurrency":"NGN","toCurrency":"USD","amount":50000,"idempotencyKey":"e2e-conv-001"}')
assert "POST /wallet/convert NGN→USD → 201" '"success":true' "$R"
assert "POST /wallet/convert shows converted amount" '"convertedAmount"' "$R"

# Insufficient balance
R_NSF=$(curl -s -X POST "$BASE/wallet/convert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"fromCurrency":"NGN","toCurrency":"EUR","amount":9999999,"idempotencyKey":"e2e-conv-nsf"}')
assert "POST /wallet/convert insufficient balance → 400" '"statusCode":400' "$R_NSF"

blue "4. WALLET — Trade (with spread)"

R=$(curl -s -X POST "$BASE/wallet/trade" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"fromCurrency":"NGN","toCurrency":"USD","amount":10000,"idempotencyKey":"e2e-trade-001"}')
assert "POST /wallet/trade BUY USD → 201" '"success":true' "$R"
assert "POST /wallet/trade shows effectiveRate" '"effectiveRate"' "$R"

# SELL USD back to NGN
R=$(curl -s -X POST "$BASE/wallet/trade" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"fromCurrency":"USD","toCurrency":"NGN","amount":1,"idempotencyKey":"e2e-trade-002"}')
assert "POST /wallet/trade SELL USD→NGN → 201" '"success":true' "$R"

blue "4. WALLET — Balance after operations"

R=$(curl -s "$BASE/wallet/balances" -H "Authorization: Bearer $USER_TOKEN")
assert "GET /wallet/balances after ops → has USD" '"currency":"USD"' "$R"

# ── 5. TRANSACTIONS ──────────────────────────────────────────────────────────

blue "5. TRANSACTIONS"

R=$(curl -s "$BASE/transactions" -H "Authorization: Bearer $USER_TOKEN")
assert "GET /transactions → 200 + paginated list" '"data"' "$R"
assert "GET /transactions has FUND entry" '"FUND"' "$R"

R=$(curl -s "$BASE/transactions?type=TRADE" -H "Authorization: Bearer $USER_TOKEN")
assert "GET /transactions?type=TRADE → filters correctly" '"TRADE"' "$R"

R=$(curl -s "$BASE/transactions?page=1&limit=2" -H "Authorization: Bearer $USER_TOKEN")
assert "GET /transactions pagination works" '"page"' "$R"

# Unauthenticated
R=$(curl -s "$BASE/transactions")
assert "GET /transactions no token → 401" '"statusCode":401' "$R"

# ── 6. ADMIN ─────────────────────────────────────────────────────────────────

blue "6. ADMIN — (requires ADMIN token)"

if [ -n "$ADMIN_TOKEN" ]; then
  R=$(curl -s "$BASE/admin/users" -H "Authorization: Bearer $ADMIN_TOKEN")
  assert "GET /admin/users → 200 + user list" '"success":true' "$R"

  # Get bob's user ID
  USER_ID=$(eval "$DB_CMD" -c "SELECT id FROM users WHERE email='e2e_user@fxapp.dev' LIMIT 1;" 2>/dev/null | tr -d ' ')

  R=$(curl -s -X PATCH "$BASE/admin/users/$USER_ID/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"isActive":false}')
  assert "PATCH /admin/users/:id/status deactivate → 200" '"success":true' "$R"

  R=$(curl -s -X PATCH "$BASE/admin/users/$USER_ID/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"isActive":true}')
  assert "PATCH /admin/users/:id/status reactivate → 200" '"success":true' "$R"

  R=$(curl -s -X POST "$BASE/admin/fx/rate-override" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"fromCurrency":"NGN","toCurrency":"USD","rate":0.0007}')
  assert "POST /admin/fx/rate-override → 201" '"success":true' "$R"

  R=$(curl -s "$BASE/admin/transactions" -H "Authorization: Bearer $ADMIN_TOKEN")
  assert "GET /admin/transactions → 200 + all transactions" '"success":true' "$R"

  # Non-admin should be rejected
  R=$(curl -s "$BASE/admin/users" -H "Authorization: Bearer $USER_TOKEN")
  assert "GET /admin/users with USER token → 403" '"statusCode":403' "$R"
else
  yellow "Skipping admin tests — no admin token"
fi

# ── 7. ANALYTICS ─────────────────────────────────────────────────────────────

blue "7. ANALYTICS — (requires ADMIN token)"

if [ -n "$ADMIN_TOKEN" ]; then
  R=$(curl -s "$BASE/analytics/trades" -H "Authorization: Bearer $ADMIN_TOKEN")
  assert "GET /analytics/trades → 200" '"success":true' "$R"

  R=$(curl -s "$BASE/analytics/fx-trends" -H "Authorization: Bearer $ADMIN_TOKEN")
  assert "GET /analytics/fx-trends → 200" '"success":true' "$R"
else
  yellow "Skipping analytics tests — no admin token"
fi

# ── 8. SECURITY CHECKS ───────────────────────────────────────────────────────

blue "8. SECURITY — Auth boundary checks"

R=$(curl -s "$BASE/wallet/balances")
assert "GET /wallet/balances no token → 401" '"statusCode":401' "$R"

R=$(curl -s "$BASE/wallet/balances" -H "Authorization: Bearer invalidtoken")
assert "GET /wallet/balances bad token → 401" '"statusCode":401' "$R"

# ── SUMMARY ──────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════"
if [ $FAIL -eq 0 ]; then
  green "ALL $PASS TESTS PASSED"
else
  echo -e "\033[33m⚠️   $PASS passed, $FAIL failed\033[0m"
fi
echo "════════════════════════════════════"
