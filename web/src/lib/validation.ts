import { z } from "zod";

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(12)
  .transform((tags) => [...new Set(tags)]);

const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const recurrenceSchema = z.enum(["once", "daily", "weekly", "monthly", "yearly"]);

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(5000).default(""),
    due_at: nullableDateTimeSchema.default(null),
    task_list_id: z.string().uuid().nullable().default(null),
    tags: tagsSchema.default([]),
    alert_enabled: z.boolean().default(true),
    alert_lead_minutes: z.number().int().min(0).max(43200).default(1440),
    status: z.enum(["open", "completed"]).default("open"),
  })
  .strict();

export const taskUpdateSchema = taskInputSchema.partial().strict();

export const reminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["reminder", "alarm"]).default("reminder"),
    remind_at: z.string().datetime({ offset: true }),
    recurrence: recurrenceSchema.default("once"),
    tags: tagsSchema.default([]),
  })
  .strict();

export const reminderUpdateSchema = reminderInputSchema.partial().strict();

const eventFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(5000).default(""),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: nullableDateTimeSchema.default(null),
    all_day: z.boolean().default(false),
    recurrence: recurrenceSchema.default("once"),
    recurrence_until: z.string().date().nullable().default(null),
    tags: tagsSchema.default([]),
    alert_enabled: z.boolean().default(true),
    alert_lead_minutes: z.number().int().min(0).max(43200).default(1440),
  })
  .strict();

export const eventInputSchema = eventFieldsSchema
  .refine(
    ({ starts_at, ends_at }) =>
      ends_at === null || new Date(ends_at).getTime() > new Date(starts_at).getTime(),
    { path: ["ends_at"], message: "The end time must be after the start time." },
  );

export const eventUpdateSchema = eventFieldsSchema.partial().strict();

export const taskListInputSchema = z
  .object({ name: z.string().trim().min(1).max(60) })
  .strict();

export type TaskInput = z.infer<typeof taskInputSchema>;
export type ReminderInput = z.infer<typeof reminderInputSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
