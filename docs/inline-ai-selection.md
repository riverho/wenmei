# Inline AI Selection — Design Spec

## Vision

Select text in the editor → floating bubble → command palette → Pi responds → text replaces. This makes Wenmei an _agentic thinking tool_: select, instruct, apply, undo — all without leaving the editor.

---

## Architecture

### Data flow

```
User selects text in <textarea>
        │
        ▼
CenterPanel tracks selectionStart/selectionEnd
        │
        ▼
Floating bubble renders near cursor
        │
        ▼
User clicks a command (Rewrite, Summarize, Explain, Custom...)
        │
        ├─► Store selection state in Zustand:
        │     selectionForRewrite: { start, end, text, filePath }
        │
        ├─► Pre-fill Pi Panel input with context prompt
        │     e.g. "In /doc.md, rewrite the following:\n\n<selection>"
        │
        ├─► (Optional) Auto-submit to Pi RPC
        │
        ▼
Pi streams response
        │
        ▼
On agent_end event:
  if selectionForRewrite is set:
    1. Push current content to contentHistory stack (for undo)
    2. Call textareaRef.current.setRangeText(response, start, end)
    3. Call setActiveFileContent(newContent) to sync store + trigger auto-save
    4. Clear selectionForRewrite
    5. Show "Applied" toast on bubble
```

### State additions (`src/store/appStore.ts`)

```typescript
interface AppState {
  // ...existing fields

  // Inline selection state
  selectionForRewrite: {
    start: number;
    end: number;
    text: string;
    filePath: string | null;
  } | null;

  // Undo stack for AI edits
  contentHistory: { content: string; cursor: number }[];
}
```

### Component changes

| File                                | Change                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `src/store/appStore.ts`             | Add `selectionForRewrite`, `contentHistory`, actions                     |
| `src/components/CenterPanel.tsx`    | Track selection, render floating bubble, detect Cmd-Z, apply replacement |
| `src/components/PiPanel.tsx`        | Signal CenterPanel on `agent_end` if selection is pending                |
| `src/hooks/useKeyboardShortcuts.ts` | Add shortcut to trigger bubble from keyboard (optional)                  |

---

## Implementation plan

### Phase 1 — Selection + bubble (CenterPanel)

- [ ] Track `onSelect` / `onMouseUp` on textarea, compute `selectionStart`/`selectionEnd`
- [ ] Store selection coordinates in Zustand: `selectionForRewrite`
- [ ] If selection is non-empty and > 3 chars, render a floating `div` near cursor
- [ ] Bubble contains: Rewrite, Summarize, Explain, Custom buttons
- [ ] Bubble hides on selection clear, blur, or Escape

### Phase 2 — Send to Pi (CenterPanel → PiPanel bridge)

- [ ] On bubble button click:
  - Store pending selection in Zustand
  - Set Pi input text to context prompt
  - Auto-focus Pi Panel input
- [ ] (Optional) Auto-submit — set `piInput`, call a helper that triggers the Pi send path

### Phase 3 — Replace on response (PiPanel → CenterPanel)

- [ ] In PiPanel's response handler (on `agent_end` or streaming text receipt), check for pending `selectionForRewrite`
- [ ] If pending: invoke a store action `applyRewrite(responseText)` or emit a signal
- [ ] In CenterPanel, a `useEffect` watches for the apply signal, calls `setRangeText()`, syncs store, clears pending state

### Phase 4 — Undo (Cmd-Z)

- [ ] Before applying rewrite, push `{ content: activeFileContent, cursor: selectionStart }` onto `contentHistory`
- [ ] On Cmd-Z (in `useKeyboardShortcuts.ts` or CenterPanel keydown), pop history and restore
- [ ] Cap history stack at 20 entries (FIFO eviction)

### Phase 5 — Polish

- [ ] Animate bubble appearance/disappearance
- [ ] Loading spinner on bubble while Pi processes
- [ ] Handle edge cases: textarea not focused, file changed mid-edit, response is empty
- [ ] Accessibility: keyboard navigation for bubble buttons

---

## Key risks

| Risk                                                 | Mitigation                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **setRangeText breaks undo**                         | `contentHistory` stack + custom Cmd-Z handler restore the snapshot                                |
| **Pi response is long/multi-block**                  | Only replace what the user selected; insert response at cursor position, don't try to merge       |
| **User navigates away mid-response**                 | On file change or selection clear, cancel pending `selectionForRewrite`                           |
| **textareaRef goes stale**                           | Store ref in a closure-safe ref; restore from ref on every effect run                             |
| **Cross-panel focus fighting**                       | Anchor interaction in editor, keep Pi Panel as a backend — user never needs to leave the editor   |
| **Bubble overlaps content**                          | Position bubble above or below selection using `getBoundingClientRect`, flip on viewport overflow |
| **Race: user starts new rewrite before Pi finishes** | Reject new bubble clicks while pending; or cancel previous and stack the new                      |

---

## Design decisions

### Why store selection in Zustand instead of a ref?

Selection needs to survive across component boundaries (CenterPanel → PiPanel → CenterPanel). Zustand provides a reactive bridge between the two components without coupling them directly.

### Why setRangeText + setActiveFileContent instead of invoking Tauri writeFile?

The textarea is the source of truth for unsaved content. `setActiveFileContent` triggers the 800ms auto-save debounce in CenterPanel, so disk writes happen automatically. We never bypass the textarea.

### Why `contentHistory` instead of relying on native undo?

`setRangeText` programmatically modifies the textarea value, which resets the native undo stack. A manual history stack is needed for reliable undo of AI-edited content.
