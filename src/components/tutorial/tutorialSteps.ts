export interface TutorialStep {
  id: string;
  /** data-tutorial attribute value on the target element. Omit for a centered modal. */
  target?: string;
  placement?: "top" | "bottom" | "left" | "right";
  title: string;
  body: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Trelline",
    body: "This quick tour covers the essentials. Takes about a minute — or skip any time.",
  },
  {
    id: "add-row",
    target: "add-row",
    placement: "bottom",
    title: "Rows organize your tasks",
    body: "Create a row for each team, phase, or category. Click Add to get started. Rename any row by double-clicking its name.",
  },
  {
    id: "new-task",
    target: "new-task",
    placement: "bottom",
    title: "Create tasks two ways",
    body: "Click New Task to open the creation panel. Or click and drag directly on the timeline canvas to place a task right where you need it.",
  },
  {
    id: "canvas-move",
    title: "Move and resize on the canvas",
    body: "Drag a task bar left or right to shift its dates. Drag either edge to resize it. All moves snap to day boundaries.",
  },
  {
    id: "task-details",
    title: "Click any task for details",
    body: "Click a task bar to open its detail panel. Add notes, mark it done, change its dates or color, or delete it — all from one place.",
  },
  {
    id: "dependencies",
    title: "Link tasks with dependency arrows",
    body: "Hover over a task bar to reveal a dot on each end. Drag from that dot to another task to draw a dependency arrow — showing which tasks must finish before others can start.",
  },
  {
    id: "zoom",
    target: "zoom",
    placement: "bottom",
    title: "Zoom the timeline",
    body: "Switch between Days, Weeks, and Months to get the right level of detail. Use Ctrl+scroll anywhere on the canvas to fine-tune the pixel scale.",
  },
  {
    id: "done",
    title: "You're ready to plan!",
    body: "That covers the essentials. You can restart this tour any time from the Settings menu — the gear icon in the top-right.",
  },
];
