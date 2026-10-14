#!/usr/bin/env bash
# Builds a release archive to copy to the server (run in CI or on a Linux x86-64 machine:
# the archive contains native modules and the Prisma engine for that platform).
#
#   deploy/scripts/package.sh            → release/tuition-<version>.tar.gz
#
# Building on the 1 GB server itself is not recommended (decision D3: CI builds it).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

version="${VERSION:-$(git describe --always --dirty 2>/dev/null || echo dev)}"
name="tuition-$version"
out="$root/release/$name"
rm -rf "$out" "$root/release/$name.tar.gz"
mkdir -p "$root/release"

pnpm install --frozen-lockfile
pnpm build
# Production dependencies only, as a standalone folder.
pnpm --filter @tuition/server deploy --prod --legacy "$out"
(cd "$out" && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma >/dev/null)
cp -r apps/web/dist "$out/web"
mkdir -p "$out/deploy"
cp -r deploy/scripts deploy/systemd deploy/nginx deploy/journald deploy/*.example "$out/deploy/"
echo "$version" >"$out/VERSION"

tar -C "$root/release" -czf "$root/release/$name.tar.gz" "$name"
rm -rf "$out"
(cd "$root/release" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
echo "$root/release/$name.tar.gz"
