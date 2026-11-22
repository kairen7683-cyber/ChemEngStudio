#!/usr/bin/env bash
set -u
STATE_FILE="/tmp/chemeng_studio_watchdog.state"
ENV_FILE="/home/kairen7683/stock-assistant/.env"
PREV_STATE="OK"
[ -f "$STATE_FILE" ] && PREV_STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "OK")

send_tg() {
  local msg="$1"
  [ -f "$ENV_FILE" ] || return 0
  local token chat_id
  token=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r')
  chat_id=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"\r')
  [ -n "$token" ] && [ -n "$chat_id" ] || return 0
  curl -sS -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    -d "chat_id=${chat_id}" --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
}

SVC_OK=0
HTTP_OK=0
systemctl is-active --quiet chemeng-studio.service && SVC_OK=1
HTTP_CODE=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/ || echo "000")
[ "$HTTP_CODE" = "200" ] && HTTP_OK=1

if [ "$SVC_OK" -eq 1 ] && [ "$HTTP_OK" -eq 1 ]; then
  if [ "$PREV_STATE" != "OK" ]; then
    echo "OK" > "$STATE_FILE"
    send_tg "[ChemEng Studio] 서비스 정상 복구 완료 (HTTP 200, $(date '+%Y-%m-%d %H:%M:%S'))"
  fi
else
  if [ "$PREV_STATE" = "OK" ]; then
    echo "DOWN" > "$STATE_FILE"
    send_tg "[ChemEng Studio] 장애 감지! (service=${SVC_OK}, HTTP=${HTTP_CODE}) — 자동 재기동 시도 중 ($(date '+%Y-%m-%d %H:%M:%S'))"
  fi
  sudo -n systemctl restart chemeng-studio.service >/dev/null 2>&1 || true
fi
