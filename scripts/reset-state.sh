#!/usr/bin/env bash
# reset-state.sh — Reset Wenmei state so onboarding shows again.
# Useful for testing the fresh-install flow.
set -euo pipefail

CONFIG_DIR="$HOME/Library/Application Support/Wenmei"
STATE_FILE="$CONFIG_DIR/state.json"
SANDBOXES_FILE="$CONFIG_DIR/sandboxes.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "No state file found at $STATE_FILE"
  exit 0
fi

echo "Backing up existing state..."
BACKUP_DIR="$CONFIG_DIR/backups/$(date '+%Y%m%d_%H%M%S')"
mkdir -p "$BACKUP_DIR"
cp "$STATE_FILE" "$BACKUP_DIR/state.json"
[ -f "$SANDBOXES_FILE" ] && cp "$SANDBOXES_FILE" "$BACKUP_DIR/sandboxes.json"

echo "Clearing vaults from state (will trigger onboarding on next launch)..."
# Remove vault entries and reset onboarding fields
# Using python for reliable JSON manipulation without extra deps
python3 -c "
import json, sys
with open('$STATE_FILE', 'r') as f:
    state = json.load(f)
# Clear vaults (triggers empty vaults → onboarding)
state['vaults'] = []
state['active_vault_id'] = 'default'
state['sandboxes'] = []
state['active_sandbox_id'] = None
state['onboarding_completed'] = False
state['first_run_at'] = None
# Also clear the localStorage store in case app is already running
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
print('State reset. Vaults cleared, onboarding_completed=False')
"

echo
echo "Done. Launch Wenmei to see the onboarding flow again."
echo "State backup: $BACKUP_DIR"