export const YVONNE_TIME_ZONE = "Africa/Lagos";

export type Recurrence = "once" | "daily" | "weekly" | "monthly" | "yearly";
export type ItemType = "task" | "reminder" | "event";

export interface TaskList {
  id: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  due_at: string | null;
  status: "open" | "completed";
  task_list_id: string | null;
  tags: string[];
  alert_enabled: boolean;
  alert_lead_minutes: number;
  created_at: string;
}

export interface Reminder {
  id: string;
  title: string;
  kind: "reminder" | "alarm";
  remind_at: string;
  timezone: string;
  recurrence: Recurrence;
  recurrence_anchor_date: string | null;
  local_time: string | null;
  status: "scheduled" | "sending" | "sent" | "cancelled";
  tags: string[];
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  timezone: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  tags: string[];
  alert_enabled: boolean;
  alert_lead_minutes: number;
  created_at: string;
}

export interface CalendarData {
  tasks: Task[];
  reminders: Reminder[];
  events: CalendarEvent[];
  taskLists: TaskList[];
}
