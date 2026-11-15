#!/bin/sh
# Führt die Tests einschließlich des SQL-Tests gegen eine Wegwerf-MySQL aus (nur Docker nötig, kein MySQL auf dem Rechner).
# Aufruf im Projektordner (mit package.json, lib/, tests/):  sh scripts/sql-test.sh
# Der Wegwerf-Container und das Netzwerk werden am Ende entfernt; die echte Datenbank wird nicht berührt.
set -eu

NETZ=garage-sqltest-netz
DB=garage-sqltest-db

aufraeumen() {
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETZ" >/dev/null 2>&1 || true
}
trap aufraeumen EXIT
aufraeumen

docker network create "$NETZ" >/dev/null
docker run -d --name "$DB" --network "$NETZ" -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=garage_test \
  mysql:8.4 --performance-schema=OFF --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null

echo "Warte auf MySQL ..."
i=0
until docker exec "$DB" mysqladmin ping -h 127.0.0.1 -uroot -ptest --silent >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "MySQL wurde nicht bereit."; docker logs "$DB" | tail -20; exit 1; }
  sleep 2
done

docker run --rm --network "$NETZ" -v "$PWD":/src:ro -e TEST_DB_HOST="$DB" -e TEST_DB_USER=root -e TEST_DB_PASSWORD=test \
  node:22-bookworm-slim sh -c 'mkdir /app && cp -r /src/package.json /src/package-lock.json /src/lib /src/tests /app/ && cd /app && npm ci --omit=dev --ignore-scripts >/dev/null 2>&1 && node --test tests/*.test.js'
