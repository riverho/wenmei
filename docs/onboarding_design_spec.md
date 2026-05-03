# Onboarding Modal — Design Spec (Simplified)

## Context

First-run UX for Wenmei. Appears when `onboarding_completed == false` and no vaults exist in state (fresh install or reset). Single-step: welcome message + all install options with checkboxes.

---

## Trigger Condition

```tsx
const { vaults, onboarding_completed } = useAppStore();
const showOnboarding = vaults.length === 0 && !onboarding_completed;
```

When true, render `<OnboardingModal />` and hide the main app layout behind it.

---

## Visual Design

### Container

- Centered modal, `max-width: 480px`, `width: 90vw`
- Background: `var(--surface-1)`, border: `1px solid var(--border)`
- Border radius: `12px`, box shadow: `0 24px 48px rgba(0,0,0,0.2)`
- Padding: `32px`

### Typography

- Title: `text-xl font-semibold`, color `var(--text-primary)`
- Body: `text-sm`, color `var(--text-secondary)`, line-height `1.6`
- Checkbox label: `text-sm`, color `var(--text-primary)`

### Color palette

All from existing CSS variables: `var(--surface-*)`, `var(--text-*)`, `var(--accent)`, `var(--border)`, `var(--muted-foreground)`

---

## Layout

```
┌─────────────────────────────────────┐
│  ✦ Wenmei                           │
│                                     │
│  Welcome to Wenmei                  │
│                                     │
│  Your calm, folder-native thinking  │
│  environment. Markdown files stay   │
│  as plain files — no database,     │
│  no proprietary format.            │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  ☑ Install CLI (wenmei command)     │
│  ☑ Finder Service (context menu)    │
│  ☑ Quick Look (markdown preview)    │
│                                     │
│  [ Install & Launch ]  [ Skip ]     │
└─────────────────────────────────────┘
```

Checkboxes: all pre-selected by default.

**Install options:**

| Option         | Script                      | Description                                             |
| -------------- | --------------------------- | ------------------------------------------------------- |
| CLI            | `install-cli.sh`            | Copies shim to `/usr/local/bin/wenmei`                  |
| Finder Service | `install-finder-service.sh` | Adds "Open in New Wenmei Window" to Finder context menu |
| Quick Look     | `install-quicklook.sh`      | Registers `.qlgenerator` for spacebar markdown preview  |

---

## State

```tsx
const [selectedOptions, setSelectedOptions] = useState({
  cli: true,
  finder: true,
  quicklook: true,
});
const [installStatus, setInstallStatus] = useState<
  "idle" | "installing" | "done"
>("idle");
const [errors, setErrors] = useState<string[]>([]);
```

---

## Behavior

### On `[Install & Launch]` click

1. Set `installStatus = "installing"` — button shows spinner, checkboxes disabled
2. Run selected scripts sequentially:
   ```tsx
   if (selectedOptions.cli) await runInstallScript("install-cli.sh");
   if (selectedOptions.finder)
     await runInstallScript("install-finder-service.sh");
   if (selectedOptions.quicklook)
     await runInstallScript("install-quicklook.sh");
   ```
3. Collect errors but continue (don't stop on first failure)
4. On completion:
   - If all selected succeeded: `completeOnboarding()`, close modal
   - If any failed: show error list below button, keep modal open so user can retry or skip
5. Button label: `"Install & Launch"` → spinner during install → `"Launch"` on done

### On `[Skip]` click

1. Call `completeOnboarding()` — persists `onboarding_completed: true`
2. Close modal

---

## Checkbox Component

- Native `<input type="checkbox">` styled with `accent-var(--accent)`
- Label is clickable (uses `htmlFor`)
- Disabled state during install (grayed out, not interactive)

---

## Error Display

If any script fails, show inline below the button:

```tsx
{
  errors.length > 0 && (
    <div className="text-xs text-destructive mt-2">
      {errors.map(e => (
        <div>• {e}</div>
      ))}
    </div>
  );
}
```

---

## Tauri Commands

```tsx
import { runInstallScript, completeOnboarding } from "@/lib/tauri-bridge";
```

---

## Files to Create

- `src/components/OnboardingModal.tsx` — single component, all inline

No new dependencies, no additional hooks needed.

---

## Acceptance Criteria

- [ ] Modal appears on fresh install (no vaults)
- [ ] All 3 checkboxes pre-selected
- [ ] Clicking `[Install & Launch]` runs selected scripts
- [ ] Spinner shown during install, checkboxes disabled
- [ ] On all-success: modal closes, app reveals, no re-show on re-launch
- [ ] On partial failure: errors shown, user can retry or skip
- [ ] `[Skip]` closes modal and marks onboarding done
