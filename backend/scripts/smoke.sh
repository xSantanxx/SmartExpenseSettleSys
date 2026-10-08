#!/usr/bin/env bash
# Manual smoke test against a running API (npm run dev).
set -euo pipefail
BASE="${BASE_URL:-http://localhost:3001}"

echo "== health =="
curl -s "$BASE/health"
echo

echo "== register Alice =="
ALICE=$(curl -s -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","displayName":"Alice","password":"password123"}')
echo "$ALICE"
ALICE_ID=$(echo "$ALICE" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
ALICE_TOKEN=$(echo "$ALICE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "== register Bob =="
BOB=$(curl -s -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d '{"email":"bob@example.com","displayName":"Bob","password":"password123"}')
echo "$BOB"
BOB_ID=$(echo "$BOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['id'])")
BOB_TOKEN=$(echo "$BOB" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

auth() { echo -H "content-type: application/json" -H "Authorization: Bearer $1"; }

echo "== create group =="
GROUP=$(curl -s -X POST "$BASE/groups" $(auth "$ALICE_TOKEN") -d '{"name":"NYC Trip"}')
echo "$GROUP"
GROUP_ID=$(echo "$GROUP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "== add Bob by email =="
curl -s -X POST "$BASE/groups/$GROUP_ID/members" $(auth "$ALICE_TOKEN") \
  -d '{"email":"bob@example.com"}'
echo

echo "== add expense =="
curl -s -X POST "$BASE/groups/$GROUP_ID/expenses" $(auth "$ALICE_TOKEN") \
  -d "{\"description\":\"Dinner\",\"amount\":\"100.00\",\"paidByUserId\":\"$ALICE_ID\",\"expenseDate\":\"2026-10-01\",\"splitMethod\":\"EQUAL\",\"participantIds\":[\"$ALICE_ID\",\"$BOB_ID\"]}"
echo

echo "== settlements =="
SETTLEMENTS=$(curl -s "$BASE/groups/$GROUP_ID/settlements" $(auth "$ALICE_TOKEN"))
echo "$SETTLEMENTS"
SETTLEMENT_ID=$(echo "$SETTLEMENTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")

if [[ -n "$SETTLEMENT_ID" ]]; then
  echo "== mark settlement completed (as Bob) =="
  curl -s -X PATCH "$BASE/settlements/$SETTLEMENT_ID" $(auth "$BOB_TOKEN") \
    -d '{"status":"COMPLETED"}'
  echo
fi

echo "== summary =="
curl -s "$BASE/groups/$GROUP_ID/summary" $(auth "$ALICE_TOKEN")
echo
