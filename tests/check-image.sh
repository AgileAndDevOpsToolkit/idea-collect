
#!/usr/bin/env bash
# Exécuter sur une image locale, avec Docker, curl et Python 3.
set -euo pipefail
image="${1:-atelier-idees:test}"
name="atelier-idees-ci-$$"
volume="$name-data"
witness="$(mktemp)"
test_dir="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  if [[ $? != 0 ]]; then docker logs --tail 80 "$name" 2>/dev/null || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$witness"
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null

start() {
  local port attempt
  docker run -d --name "$name" --read-only --cap-drop ALL \
    --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=64m \
    -v "$volume:/data" -p 127.0.0.1::8080 "$image" >/dev/null
  port="$(docker port "$name" 8080/tcp)"
  if [[ -z "$port" ]]; then
    echo "Impossible de récupérer le port HTTP du conteneur." >&2
    return 1
  fi
  base="http://$port"

  # docker run -d rend la main avant qu'Apache ait commencé à écouter.
  # curl --retry-connrefused ne réessaie PAS l'erreur 56 (connection reset).
  # Retenter toute erreur réseau et tout HTTP non-2xx pendant le démarrage.
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if curl --fail --silent --connect-timeout 2 --max-time 5 \
      "$base/health.php" >/dev/null 2>&1; then
      echo "Application prête sur $base (tentative $attempt)."
      return 0
    fi

    if [[ "$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]]; then
      echo "Le conteneur s'est arrêté avant que l'application soit prête." >&2
      return 1
    fi
    sleep 1
  done

  echo "Application non prête après 30 vérifications : $base/health.php" >&2
  curl --fail --show-error --silent --connect-timeout 2 --max-time 5 \
    "$base/health.php" >/dev/null || true
  return 1
}
start
docker exec "$name" sh -ec 'find app public -type f -name "*.php" -print0 | xargs -0 -n1 php -l'
python3 "$test_dir/smoke.py" "$base" --record "$witness"
docker rm -f "$name" >/dev/null
start
python3 "$test_dir/smoke.py" "$base" --verify "$witness"
