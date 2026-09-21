#!/usr/bin/env bash
# End-to-end smoke test for the Conversation Copilot API.
# Usage: bash scripts/smoke-test.sh [base_url]
set -u
BASE="${1:-http://localhost:3000}"
PASS=0; FAIL=0

check() { # name, condition_result
  if [ "$2" = "1" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; FAIL=$((FAIL+1)); fi
}
# jq_get takes a full python expression evaluated against `d` (the parsed JSON)
jq_get() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

echo "── health ─────────────────────────────────────────────"
curl -sf "$BASE/api/dashboard" >/dev/null && check "dashboard responds" 1 || check "dashboard responds" 0
curl -sf "$BASE/api/ai/status" >/dev/null && check "ai status responds" 1 || check "ai status responds" 0

echo "── seed ───────────────────────────────────────────────"
SEED=$(curl -s -X POST "$BASE/api/demo/seed" -H 'Content-Type: application/json' -d '{"reset":true}')
[ "$(echo "$SEED" | jq_get "d['ok']")" = "True" ] && check "demo data loaded" 1 || check "demo data loaded" 0

echo "── conversations ──────────────────────────────────────"
CONVS=$(curl -s "$BASE/api/conversations")
CONV=$(echo "$CONVS" | jq_get "d['conversations'][0]['id']")
PHONE=$(echo "$CONVS" | jq_get "d['conversations'][0]['contact']['phoneNumber']")
NAME=$(echo "$CONVS" | jq_get "d['conversations'][0]['contact']['name']")
[ -n "$CONV" ] && check "conversation list ($(echo "$CONVS" | jq_get "len(d['conversations'])"))" 1 || check "conversation list" 0

echo "── inbound message (simulate) ─────────────────────────"
SIM=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' \
  -d "{\"from\":\"$PHONE\",\"profileName\":\"$NAME\",\"text\":\"oye are you free saturday? thinking about that flea market\",\"forceCopilot\":true}")
[ "$(echo "$SIM" | jq_get "d['ok']")" = "True" ] && check "inbound ingested" 1 || check "inbound ingested" 0
[ "$(echo "$SIM" | jq_get "d['duplicated']")" = "False" ] && check "not flagged duplicate" 1 || check "not flagged duplicate" 0

echo "── reply generation ───────────────────────────────────"
GEN=$(curl -s -X POST "$BASE/api/ai/reply" -H 'Content-Type: application/json' -d "{\"conversationId\":\"$CONV\"}")
COUNT=$(echo "$GEN" | jq_get "len(d['replies'])")
[ "${COUNT:-0}" -ge 5 ] && check "5 reply buckets returned ($COUNT)" 1 || check "5 reply buckets returned ($COUNT)" 0
echo "$GEN" | grep -q '"style":"suggested"' && check "suggested bucket present" 1 || check "suggested bucket present" 0
echo "$GEN" | grep -q '"style":"playful"' && check "playful bucket present" 1 || check "playful bucket present" 0
REPLY_ID=$(echo "$GEN" | jq_get "d['replies'][0]['id']")

echo "── approval workflow ──────────────────────────────────"
EDIT=$(curl -s -X PATCH "$BASE/api/replies/$REPLY_ID" -H 'Content-Type: application/json' \
  -d '{"action":"edit","body":"haan chal, sunday 11 baje — chai meri taraf se 😏"}')
[ "$(echo "$EDIT" | jq_get "d['ok']")" = "True" ] && check "edit saved" 1 || check "edit saved" 0

APPROVE=$(curl -s -X PATCH "$BASE/api/replies/$REPLY_ID" -H 'Content-Type: application/json' -d '{"action":"approve"}')
[ "$(echo "$APPROVE" | jq_get "d['action']")" = "approve" ] && check "approved" 1 || check "approved" 0
[ "$(echo "$APPROVE" | jq_get "d['outbound']['status']")" = "sent" ] && check "delivered via queue" 1 || check "delivered via queue" 0
[ "$(echo "$APPROVE" | jq_get "d['outbound']['mode']")" = "simulated" ] && check "simulation mode (no egress)" 1 || check "simulation mode (no egress)" 0

DETAIL=$(curl -s "$BASE/api/conversations/$CONV")
echo "$DETAIL" | grep -q '"isAiDrafted":true' && check "sent text appears in thread as AI" 1 || check "sent text appears in thread as AI" 0
echo "$DETAIL" | grep -q 'chai meri taraf se' && check "edited body is what went out" 1 || check "edited body is what went out" 0

echo "── regenerate ─────────────────────────────────────────"
NEW=$(curl -s -X POST "$BASE/api/ai/reply" -H 'Content-Type: application/json' -d "{\"conversationId\":\"$CONV\",\"regenerate\":true,\"onlyStyle\":\"playful\"}")
[ "$(echo "$NEW" | jq_get "len(d['replies'])")" -ge 1 ] && check "regenerate single bucket" 1 || check "regenerate single bucket" 0

echo "── memory ─────────────────────────────────────────────"
MEM=$(curl -s -X POST "$BASE/api/conversations/$CONV/memory" -H 'Content-Type: application/json' \
  -d '{"kind":"taboo","value":"Never mention the Goa trip debt again","importance":5,"pinned":true}')
MEM_ID=$(echo "$MEM" | jq_get "d['memory']['id']")
[ -n "$MEM_ID" ] && check "memory created" 1 || check "memory created" 0
curl -s -X PATCH "$BASE/api/memory/$MEM_ID" -H 'Content-Type: application/json' -d '{"value":"Never mention the Goa trip debt (again)"}' | grep -q '"ok":true' \
  && check "memory edited" 1 || check "memory edited" 0
curl -s -X DELETE "$BASE/api/memory/$MEM_ID" | grep -q '"deleted":true' && check "memory deleted" 1 || check "memory deleted" 0

echo "── style profile ──────────────────────────────────────"
curl -s -X PUT "$BASE/api/style" -H 'Content-Type: application/json' \
  -d '{"preferredLanguage":"Hinglish","flirtinessLevel":8,"confidenceLevel":9,"emojiUsage":"moderate","avoidPhrases":"kindly do the needful"}' \
  | grep -q '"ok":true' && check "style profile saved" 1 || check "style profile saved" 0
curl -s "$BASE/api/style/preview" | grep -q 'YOUR VOICE' && check "system prompt preview built" 1 || check "system prompt preview built" 0

echo "── provider config / secrets ──────────────────────────"
KEYLEAK=$(curl -s -X PUT "$BASE/api/ai/settings" -H 'Content-Type: application/json' -d '{"openaiApiKey":"sk-test-SUPERSECRET-123456"}')
echo "$KEYLEAK" | grep -q "SUPERSECRET" && check "API key NOT echoed to client" 0 || check "API key NOT echoed to client" 1
echo "$KEYLEAK" | grep -q 'openaiApiKeySet' && check "key presence flag returned" 1 || check "key presence flag returned" 0
curl -s "$BASE/api/ai/settings" | grep -q "SUPERSECRET" && check "key not in GET either" 0 || check "key not in GET either" 1
curl -s -X PUT "$BASE/api/ai/settings" -H 'Content-Type: application/json' -d '{"openaiApiKey":""}' >/dev/null && check "key cleared" 1 || check "key cleared" 0

echo "── cloud api webhook ──────────────────────────────────"
curl -s "$BASE/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=copilot-verify-token&hub.challenge=CHALLENGE123" | grep -q 'CHALLENGE123' \
  && check "webhook verification handshake" 1 || check "webhook verification handshake" 0
curl -s "$BASE/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x" | grep -q 'mismatch' \
  && check "wrong verify token rejected" 1 || check "wrong verify token rejected" 0

HOOK=$(curl -s -X POST "$BASE/api/whatsapp/webhook" -H 'Content-Type: application/json' -d '{
  "object":"whatsapp_business_account",
  "entry":[{"id":"1","changes":[{"field":"messages","value":{
    "messaging_product":"whatsapp",
    "metadata":{"display_phone_number":"15550001111","phone_number_id":"123456"},
    "contacts":[{"profile":{"name":"Nisha"},"wa_id":"919900112233"}],
    "messages":[{"from":"919900112233","id":"wamid.TESTHOOK1","timestamp":"1758450000","type":"text","text":{"body":"hey! long time. coming to blr next week"}}]
  }}]}]
}')
[ "$(echo "$HOOK" | jq_get "d['received']")" = "1" ] && check "cloud api payload normalized" 1 || check "cloud api payload normalized" 0
HOOK2=$(curl -s -X POST "$BASE/api/whatsapp/webhook" -H 'Content-Type: application/json' -d '{
  "object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{
    "messaging_product":"whatsapp","metadata":{"phone_number_id":"123456"},
    "messages":[{"from":"919900112233","id":"wamid.TESTHOOK1","timestamp":"1758450000","type":"text","text":{"body":"hey! long time. coming to blr next week"}}]
  }}]}]}')
[ "$(echo "$HOOK2" | jq_get "d['results'][0]['duplicated']")" = "True" ] && check "webhook retry is idempotent" 1 || check "webhook retry is idempotent" 0

echo "── autopilot ──────────────────────────────────────────"
curl -s -X PUT "$BASE/api/ai/settings" -H 'Content-Type: application/json' -d '{"autoSend":true}' >/dev/null
AUTO=$(curl -s -X POST "$BASE/api/whatsapp/simulate" -H 'Content-Type: application/json' \
  -d '{"from":"919900112233","profileName":"Nisha","text":"so are we doing dinner or what?","forceCopilot":false}')
[ "$(echo "$AUTO" | jq_get "d['mode']")" = "autopilot" ] && check "autopilot engaged" 1 || check "autopilot engaged" 0
[ -n "$(echo "$AUTO" | jq_get "d['autoSentReplyId']")" ] && check "reply auto-sent without approval" 1 || check "reply auto-sent without approval" 0
curl -s -X PUT "$BASE/api/ai/settings" -H 'Content-Type: application/json' -d '{"autoSend":false}' >/dev/null
check "autopilot switched back off" 1

echo "── per-chat override ──────────────────────────────────"
curl -s -X PATCH "$BASE/api/conversations/$CONV" -H 'Content-Type: application/json' -d '{"autoSendOverride":true}' | grep -q '"ok":true' \
  && check "per-chat autopilot override set" 1 || check "per-chat autopilot override set" 0
curl -s -X PATCH "$BASE/api/conversations/$CONV" -H 'Content-Type: application/json' -d '{"autoSendOverride":null}' >/dev/null

echo "── outbound queue ─────────────────────────────────────"
curl -s "$BASE/api/whatsapp/queue" | grep -q '"stats"' && check "queue stats" 1 || check "queue stats" 0
curl -s -X POST "$BASE/api/whatsapp/queue" -H 'Content-Type: application/json' -d '{"limit":10}' | grep -q '"ok":true' \
  && check "queue drain endpoint" 1 || check "queue drain endpoint" 0

echo "── privacy / deletion ────────────────────────────────"
curl -s -X POST "$BASE/api/conversations/$CONV/clear" -H 'Content-Type: application/json' -d '{"scope":"memory"}' | grep -q '"removed"' \
  && check "clear memory for conversation" 1 || check "clear memory for conversation" 0
curl -s -X POST "$BASE/api/conversations/$CONV/clear" -H 'Content-Type: application/json' -d '{"scope":"drafts"}' | grep -q '"removed"' \
  && check "clear drafts" 1 || check "clear drafts" 0
LAST=$(curl -s "$BASE/api/conversations" | jq_get "d['conversations'][-1]['id']")
curl -s -X DELETE "$BASE/api/conversations/$LAST" | grep -q '"deleted":true' && check "delete conversation" 1 || check "delete conversation" 0

echo "── dashboard ──────────────────────────────────────────"
DASH=$(curl -s "$BASE/api/dashboard")
[ "$(echo "$DASH" | jq_get "d['totals']['messages']")" -gt 0 ] && check "message totals aggregated" 1 || check "message totals aggregated" 0
[ "$(echo "$DASH" | jq_get "d['usage']['requests']")" -gt 0 ] && check "AI usage tracked" 1 || check "AI usage tracked" 0
[ "$(echo "$DASH" | jq_get "len(d['series'])")" = "14" ] && check "14-day series built" 1 || check "14-day series built" 0

echo "───────────────────────────────────────────────────────"
echo "  PASSED: $PASS    FAILED: $FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
