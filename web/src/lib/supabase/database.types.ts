type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      tasks: Table<
        {
          id: string;
          user_jid: string;
          title: string;
          notes: string;
          due_at: string | null;
          status: "open" | "completed";
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          task_list_id: string | null;
          tags: string[];
          alert_enabled: boolean;
          alert_lead_minutes: number;
        },
        {
          id?: string;
          user_jid: string;
          title: string;
          notes?: string;
          due_at?: string | null;
          status?: "open" | "completed";
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          task_list_id?: string | null;
          tags?: string[];
          alert_enabled?: boolean;
          alert_lead_minutes?: number;
        }
      >;
      task_lists: Table<
        {
          id: string;
          user_jid: string;
          name: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_jid: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      reminders: Table<
        {
          id: string;
          user_jid: string;
          title: string;
          kind: "reminder" | "alarm";
          remind_at: string;
          timezone: string;
          recurrence: Recurrence;
          recurrence_anchor_date: string | null;
          local_time: string | null;
          status: "scheduled" | "sending" | "sent" | "cancelled";
          tags: string[];
          task_id: string | null;
          calendar_event_id: string | null;
          created_at: string;
          updated_at: string;
          sent_at: string | null;
          last_sent_at: string | null;
          last_error: string | null;
        },
        {
          id?: string;
          user_jid: string;
          title: string;
          kind?: "reminder" | "alarm";
          remind_at: string;
          timezone?: string;
          recurrence?: Recurrence;
          recurrence_anchor_date?: string | null;
          local_time?: string | null;
          status?: "scheduled" | "sending" | "sent" | "cancelled";
          tags?: string[];
          task_id?: string | null;
          calendar_event_id?: string | null;
          created_at?: string;
          updated_at?: string;
          sent_at?: string | null;
          last_sent_at?: string | null;
          last_error?: string | null;
        }
      >;
      calendar_events: Table<
        {
          id: string;
          user_jid: string;
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
          updated_at: string;
        },
        {
          id?: string;
          user_jid: string;
          title: string;
          notes?: string;
          starts_at: string;
          ends_at?: string | null;
          all_day?: boolean;
          timezone?: string;
          recurrence?: Recurrence;
          recurrence_until?: string | null;
          tags?: string[];
          alert_enabled?: boolean;
          alert_lead_minutes?: number;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

import type { Recurrence } from "@/lib/domain";
