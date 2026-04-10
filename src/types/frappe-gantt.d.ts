declare module "frappe-gantt" {
  export interface GanttTask {
    id: string;
    name: string;
    start: string; // "YYYY-MM-DD"
    end: string;   // "YYYY-MM-DD"
    progress?: number;
    dependencies?: string; // comma-separated task IDs
    custom_class?: string;
    [key: string]: unknown;
  }

  export type ViewMode = "Quarter Day" | "Half Day" | "Day" | "Week" | "Month";

  export interface GanttOptions {
    header_height?: number;
    column_width?: number;
    step?: number;
    view_modes?: ViewMode[];
    bar_height?: number;
    bar_corner_radius?: number;
    arrow_curve?: number;
    padding?: number;
    view_mode?: ViewMode;
    date_format?: string;
    custom_popup_html?: ((task: GanttTask) => string) | null;
    on_click?: (task: GanttTask) => void;
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void;
    on_progress_change?: (task: GanttTask, progress: number) => void;
    on_view_change?: (mode: ViewMode) => void;
    popup_trigger?: string;
    language?: string;
  }

  export default class Gantt {
    constructor(
      wrapper: string | HTMLElement,
      tasks: GanttTask[],
      options?: GanttOptions
    );
    change_view_mode(mode: ViewMode): void;
    refresh(tasks: GanttTask[]): void;
    readonly tasks: GanttTask[];
  }
}
