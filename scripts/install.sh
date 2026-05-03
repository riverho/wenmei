#!/usr/bin/env bash
# install.sh — Install all Wenmei system integrations.
# Run this after first launch to set up CLI, Finder service, and Quick Look.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

main() {
  echo "=== Wenmei System Integration Installer ==="
  echo

  local cli=0 finder=0 quicklook=0

  for arg in "$@"; do
    case "$arg" in
      --cli) cli=1 ;;
      --finder) finder=1 ;;
      --quicklook) quicklook=1 ;;
      --all) cli=1; finder=1; quicklook=1 ;;
      -h|--help)
        echo "Usage: install.sh [options]"
        echo "  --all       Install CLI + Finder + Quick Look"
        echo "  --cli       CLI shim only (wenmei command)"
        echo "  --finder    Finder Service only"
        echo "  --quicklook Quick Look plugin only"
        echo "  (no args)   Install CLI + Finder (default)"
        exit 0 ;;
      *) echo "Unknown flag: $arg" >&2; exit 2 ;;
    esac
  done

  # Default: CLI + Finder
  if (( ! cli && ! finder && ! quicklook )); then
    cli=1; finder=1
  fi

  (( cli )) && install_cli
  (( finder )) && install_finder
  (( quicklook )) && install_quicklook

  echo
  echo "Done!"
  (( cli )) && echo "  CLI: wenmei /path/to/file.md  (from any terminal)"
  (( finder )) && echo "  Finder: Right-click file → Open in New Wenmei Window"
  (( quicklook )) && echo "  Quick Look: Select .md file + press Space"
}

install_cli() {
  echo "[1] Installing CLI shim..."
  bash "$SCRIPT_DIR/install-cli.sh"
}

install_finder() {
  echo
  echo "[2] Installing Finder Service..."
  bash "$SCRIPT_DIR/install-finder-service.sh"
}

install_quicklook() {
  echo
  echo "[3] Installing Quick Look plugin..."
  if [ -f "$SCRIPT_DIR/install-quicklook.sh" ]; then
    bash "$SCRIPT_DIR/install-quicklook.sh"
  else
    echo "  Quick Look plugin not yet available. See docs/first_run_onboarding.md"
  fi
}

main "$@"