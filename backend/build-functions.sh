#!/usr/bin/env bash
# Собирает ZIP-архивы обеих функций для загрузки в Yandex Cloud Functions.
# Запуск из папки backend:  bash build-functions.sh
# Результат:  dist/form-intake.zip  и  dist/admin-api.zip
#
# В каждой папке функции ставятся зависимости (ydb-sdk, web-push для form-intake),
# чтобы node_modules попал в архив.

set -e
cd "$(dirname "$0")"
mkdir -p dist

for fn in form-intake admin-api; do
  echo "==> $fn: установка зависимостей"
  ( cd "$fn" && npm install --omit=dev )
  echo "==> $fn: упаковка"
  rm -f "dist/$fn.zip"
  ( cd "$fn" && zip -r -q "../dist/$fn.zip" index.js package.json node_modules )
  echo "готово: dist/$fn.zip"
done

echo
echo "Оба архива в backend/dist/. Загрузите их в соответствующие функции"
echo "(способ «ZIP-архив»), точка входа index.handler."
