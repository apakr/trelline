# Canvas Integration Notes

Instructions for wiring TimelineCanvas into the rest of the app once it's built.
Read this before starting canvas implementation.

---

## RowPanel alignment

RowPanel currently uses a fixed `ROW_HEIGHT` constant for every row. The custom canvas
will need variable row heights — rows expand vertically when tasks overlap and stack into
sub-lanes. When that's built:

1. **Canvas computes row heights.** After the overlap-packing algorithm runs, the canvas
   knows how many sub-lanes each row needs. Row height = `subLaneCount * LANE_HEIGHT`.

2. **Pass row heights down from TimelineView.** TimelineView should compute a
   `rowHeights: Map<string, number>` from whatever the canvas exposes, and pass it as a
   prop to RowPanel. RowPanel uses it to size each row label to match.

3. **RowPanel props to add:**
   ```ts
   rowHeights: Map<string, number>  // rowId → height in px
   ```
   Replace the fixed `ROW_HEIGHT` in RowItem with `rowHeights.get(row.id) ?? ROW_HEIGHT`.

---

## Header height alignment

RowPanel has a `HEADER_HEIGHT` constant for the top section (holds the "Rows" label and
"+ Add" button). The canvas has a date axis header at the top. These two must be the same
height so the row labels align with the canvas row bands.

When building the canvas, decide on the date axis header height, then set `HEADER_HEIGHT`
in RowPanel to match exactly.

---

## Scroll sync

When Frappe was in use, RowPanel had a `bodyRef` that Frappe's scroll container synced
to. That's been removed. With the custom canvas, do it the other way around:

- The canvas owns the scroll container (the horizontally+vertically scrollable SVG area)
- On vertical scroll, the canvas reads `scrollTop` and passes it to RowPanel via a prop
  or callback so RowPanel's row list stays in sync

**Suggested approach:**
1. Canvas maintains `scrollTop` in state, updated by its scroll handler
2. TimelineView passes `scrollTop` down to RowPanel as a prop
3. RowPanel applies it to its row list container via a ref: `rowListRef.current.scrollTop = scrollTop`

**RowPanel props to add:**
```ts
scrollTop: number
```

---

## WorkspaceContext hooks the canvas needs

```ts
const { setPanel, updateTask } = useWorkspace();
```

- `setPanel({ type: "task", taskId })` — call on task bar click
- `setPanel({ type: "newTask" })` — call on empty row click (optional, TopBar already does this)
- `updateTask(taskId, { start, end })` — call on drag/resize complete
- `updateTask(taskId, { dependencies })` — call when a dependency link is created or deleted

---

## TimelineView props to add when canvas is ready

```tsx
// In TimelineView, after canvas is built:
const [canvasScrollTop, setCanvasScrollTop] = useState(0);
const rowHeights = /* derived from canvas overlap computation */;

<RowPanel
  ...existingProps
  scrollTop={canvasScrollTop}
  rowHeights={rowHeights}
/>
<TimelineCanvas
  ...existingProps
  onScrollTop={setCanvasScrollTop}
/>
```
