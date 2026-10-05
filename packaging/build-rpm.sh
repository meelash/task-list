#!/usr/bin/env bash
# Builds dist/task-list-<version>-<timestamp>.noarch.rpm from this checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json)
release=$(date +%Y%m%d%H%M)     # a fresh release each build, so dnf treats it as an upgrade
top="$PWD/dist/rpmbuild"
rm -rf "$top"
mkdir -p "$top/SOURCES"

tar czf "$top/SOURCES/task-list-$version.tar.gz" --transform "s,^,task-list-$version/," \
  index.html server.js README.md LICENSE packaging/

rpmbuild --quiet -bb packaging/task-list.spec \
  --define "_topdir $top" --define "pkgversion $version" --define "pkgrelease $release"

rpm=$(ls "$top"/RPMS/noarch/task-list-*.rpm)
cp "$rpm" dist/
echo "Built dist/$(basename "$rpm")"
echo
echo "Install or upgrade with:"
echo "  sudo dnf install ./dist/$(basename "$rpm") && systemctl --user daemon-reload && systemctl --user restart task-list"
