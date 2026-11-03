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
  docker run -d --name "$name" --read-only --cap-drop ALL \
    --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=64m \
    -v "$volume:/data" -p 127.0.0.1::8080 "$image" >/dev/null
  base="http://$(docker port "$name" 8080/tcp)"
  curl --retry 20 --retry-delay 1 --retry-connrefused --max-time 5 -fsS "$base/health.php" >/dev/null
}
start
docker exec "$name" sh -ec 'find app public -type f -name "*.php" -print0 | xargs -0 -n1 php -l'
python3 "$test_dir/smoke.py" "$base" --record "$witness"
docker rm -f "$name" >/dev/null
start
python3 "$test_dir/smoke.py" "$base" --verify "$witness"
