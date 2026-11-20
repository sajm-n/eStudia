#!/usr/bin/env bash
# Inteligentna pętla powiadomień:
# - Trzyma push-state.json i push-subscriptions.json na osobnej gałęzi technicznej (domyślnie: push-state),
#   dzięki czemu gałąź main pozostaje czysta i nie wyzwala przebudów GitHub Pages.
# - Jeśli w najbliższych WINDOW_MINUTES (domyślnie 75 min) nie ma żadnych zadań do powiadomienia,
#   kończy pracę od razu po ~5 sekundach zamiast utrzymywać runner przy życiu przez wiele godzin.
set -u

BRANCH="${BRANCH:-main}"
STATE_BRANCH="${STATE_BRANCH:-push-state}"
STATE_DIR="${STATE_DIR:-/tmp/estudia-push-state}"
LOOP_SECONDS="${LOOP_SECONDS:-4500}"    # 75 min (cron uruchamia workflow co 60 min)
WINDOW_MINUTES="${WINDOW_MINUTES:-75}"
SLEEP="${SLEEP:-60}"
STATE_FILES="push-state.json push-subscriptions.json"

# Zły lub brakujący sekret: przebieg kończy się na czerwono od razu
if ! node scripts/notify.mjs --check; then
  echo "::error::Powiadomienia nie mogą działać: popraw sekret VAPID_PRIVATE_KEY (szczegóły wyżej)."
  exit 1
fi

REMOTE_URL="$(git remote get-url origin)"
AUTH_HEADER="$(git config --get http.https://github.com/.extraheader || true)"

git_state() {
  if [ -n "$AUTH_HEADER" ]; then
    git -C "$STATE_DIR" -c "http.https://github.com/.extraheader=$AUTH_HEADER" "$@"
  else
    git -C "$STATE_DIR" "$@"
  fi
}

init_state_repo() {
  rm -rf "$STATE_DIR"
  mkdir -p "$STATE_DIR"
  git -C "$STATE_DIR" init -q
  git -C "$STATE_DIR" config user.name "github-actions[bot]"
  git -C "$STATE_DIR" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git -C "$STATE_DIR" remote add origin "$REMOTE_URL"
  if git_state fetch -q --depth=1 origin "$STATE_BRANCH" 2>/dev/null; then
    git -C "$STATE_DIR" checkout -q -B "$STATE_BRANCH" FETCH_HEAD
  else
    echo "Inicjalizacja nowej gałęzi stanu: $STATE_BRANCH"
    git -C "$STATE_DIR" checkout -q --orphan "$STATE_BRANCH"
    printf '{\n  "sent": {},\n  "fail": {}\n}\n' > "$STATE_DIR/push-state.json"
    printf '[]\n' > "$STATE_DIR/push-subscriptions.json"
    git -C "$STATE_DIR" add $STATE_FILES
    git -C "$STATE_DIR" commit -q -m "Inicjalizacja stanu powiadomień"
    git_state push -q origin "HEAD:$STATE_BRANCH" || echo "::warning::Nie udało się utworzyć gałęzi $STATE_BRANCH"
  fi
}

sync_main() {
  git fetch -q --depth=1 origin "$BRANCH" && git reset -q --hard FETCH_HEAD
}

sync_state() {
  git_state fetch -q --depth=1 origin "$STATE_BRANCH" && git -C "$STATE_DIR" reset -q --hard FETCH_HEAD
}

commit_state() {
  # shellcheck disable=SC2086
  [ -z "$(git -C "$STATE_DIR" status --porcelain $STATE_FILES)" ] && return 0
  # shellcheck disable=SC2086
  git -C "$STATE_DIR" add $STATE_FILES
  # --amend + --force-with-lease utrzymuje gałąź push-state na 1 commicie (zero rozrostu historii),
  # a jednocześnie bezpiecznie odrzuci push, jeśli aplikacja w międzyczasie dopisała urządzenie.
  git -C "$STATE_DIR" commit -q --amend -m "Powiadomienia: stan wysyłki"
  git_state push -q --force-with-lease origin "HEAD:$STATE_BRANCH" && return 0

  # Ktoś (aplikacja) wypchnął w międzyczasie: pobierz najnowsze subskrypcje i dołóż nasz push-state.json
  cp "$STATE_DIR/push-state.json" /tmp/push-state.mine.json
  sync_state || return 1
  cp /tmp/push-state.mine.json "$STATE_DIR/push-state.json"
  [ -z "$(git -C "$STATE_DIR" status --porcelain push-state.json)" ] && return 0
  git -C "$STATE_DIR" add push-state.json
  git -C "$STATE_DIR" commit -q --amend -m "Powiadomienia: stan wysyłki"
  git_state push -q --force-with-lease origin "HEAD:$STATE_BRANCH" || {
    echo "::warning::Nie udało się zapisać stanu wysyłki na gałęzi $STATE_BRANCH"
    sync_state
  }
}

init_state_repo

END=$(( $(date +%s) + LOOP_SECONDS ))
while :; do
  sync_main || echo "::warning::Nie udało się pobrać gałęzi $BRANCH, używam poprzedniej wersji"
  sync_state || echo "::warning::Nie udało się pobrać gałęzi $STATE_BRANCH, używam poprzedniej wersji"

  timeout 180 env STATE_DIR="$STATE_DIR" node scripts/notify.mjs; rc=$?
  [ "$rc" -eq 124 ] && echo "::warning::notify.mjs przekroczył 180 s i został przerwany"
  commit_state || true

  # Sprawdź, czy w najbliższych WINDOW_MINUTES minutach jest jeszcze na co czekać
  next_out="$(STATE_DIR="$STATE_DIR" WINDOW_MINUTES="$WINDOW_MINUTES" node scripts/notify.mjs --next)"
  next_rc=$?
  echo "Okno powiadomień: $next_out"
  if [ "$next_rc" -eq 10 ]; then
    echo "Brak zadań do powiadomienia w najbliższych ${WINDOW_MINUTES} min — kończę przebieg."
    break
  fi

  [ "$(date +%s)" -ge "$END" ] && break
  sleep "$SLEEP"
  [ "$(date +%s)" -ge "$END" ] && break
done
echo "Koniec pętli."
