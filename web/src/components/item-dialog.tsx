"use client";

import { type FormEvent, useState } from "react";
import { Bell, CalendarDays, Check, ListTodo, Trash2 } from "lucide-react";
import type { CalendarEvent, ItemType, Recurrence, Reminder, Task, TaskList } from "@/lib/domain";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { fromLagosDateTimeValue, toLagosDateTimeValue } from "@/lib/time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type EditableRecord =
  | { type: "task"; item: Task }
  | { type: "reminder"; item: Reminder }
  | { type: "event"; item: CalendarEvent };

const recurrenceOptions: { value: Recurrence; label: string }[] = [
  { value: "once", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

const alertLeadOptions = [
  { value: "15", label: "15 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "180", label: "3 hours before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
];

function parseTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

async function readError(response: Response) {
  const result = await response.json().catch(() => null);
  return typeof result?.error === "string" ? result.error : "The request could not be completed.";
}

export function ItemDialog({
  open,
  onOpenChange,
  taskLists,
  createType,
  editing,
  initialDate,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskLists: TaskList[];
  createType: ItemType;
  editing: EditableRecord | null;
  initialDate: string;
  onSaved: (warning?: string | null) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [type, setType] = useState<ItemType>(editing?.type ?? createType);
  const [title, setTitle] = useState(editing?.item.title ?? "");
  const [notes, setNotes] = useState(
    editing?.type === "task" || editing?.type === "event" ? editing.item.notes : "",
  );
  const [dueAt, setDueAt] = useState(
    editing?.type === "task" && editing.item.due_at
      ? toLagosDateTimeValue(editing.item.due_at)
      : "",
  );
  const [startsAt, setStartsAt] = useState(() =>
    editing?.type === "event"
      ? toLagosDateTimeValue(editing.item.starts_at)
      : editing?.type === "reminder"
        ? toLagosDateTimeValue(editing.item.remind_at)
        : `${initialDate}T09:00`,
  );
  const [endsAt, setEndsAt] = useState(
    editing?.type === "event" && editing.item.ends_at
      ? toLagosDateTimeValue(editing.item.ends_at)
      : "",
  );
  const [allDay, setAllDay] = useState(editing?.type === "event" ? editing.item.all_day : false);
  const [taskListId, setTaskListId] = useState(
    editing?.type === "task" ? editing.item.task_list_id ?? "" : taskLists[0]?.id ?? "",
  );
  const [kind, setKind] = useState<"reminder" | "alarm">(
    editing?.type === "reminder" ? editing.item.kind : "reminder",
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(
    editing?.type === "reminder" || editing?.type === "event"
      ? editing.item.recurrence
      : "once",
  );
  const [recurrenceUntil, setRecurrenceUntil] = useState(
    editing?.type === "event" ? editing.item.recurrence_until ?? "" : "",
  );
  const [tags, setTags] = useState(
    editing?.type === "task" || editing?.type === "reminder" || editing?.type === "event"
      ? editing.item.tags.join(", ")
      : "",
  );
  const [alertEnabled, setAlertEnabled] = useState(
    editing?.type === "task" || editing?.type === "event" ? editing.item.alert_enabled : true,
  );
  const [alertLeadMinutes, setAlertLeadMinutes] = useState(
    editing?.type === "task" || editing?.type === "event"
      ? String(editing.item.alert_lead_minutes)
      : "1440",
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleText = editing
    ? `Edit ${editing.type === "event" ? "event" : editing.type}`
    : `Create ${type === "event" ? "event" : type}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const tagsValue = parseTags(tags);
      let payload: Record<string, unknown>;
      if (type === "task") {
        payload = {
          title,
          notes,
          due_at: dueAt ? fromLagosDateTimeValue(dueAt) : null,
          task_list_id: taskListId || null,
          tags: tagsValue,
          alert_enabled: alertEnabled,
          alert_lead_minutes: Number(alertLeadMinutes),
        };
      } else if (type === "reminder") {
        const remindAt = fromLagosDateTimeValue(startsAt);
        if (!remindAt) throw new Error("Choose a reminder time.");
        payload = { title, kind, remind_at: remindAt, recurrence, tags: tagsValue };
      } else {
        const start = fromLagosDateTimeValue(startsAt);
        if (!start) throw new Error("Choose an event start time.");
        payload = {
          title,
          notes,
          starts_at: start,
          ends_at: endsAt ? fromLagosDateTimeValue(endsAt) : null,
          all_day: allDay,
          recurrence,
          recurrence_until: recurrenceUntil || null,
          tags: tagsValue,
          alert_enabled: alertEnabled,
          alert_lead_minutes: Number(alertLeadMinutes),
        };
      }

      const collection = type === "event" ? "events" : type === "task" ? "tasks" : "reminders";
      const endpoint = editing
        ? `/api/${collection}/${encodeURIComponent(editing.item.id)}`
        : `/api/${collection}`;
      const response = await fetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readError(response));

      const result = await response.json();
      const warning = result?.alert?.warning ?? null;
      await onSaved(warning);
      onOpenChange(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The item could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setPending(true);
    setError("");
    const collection =
      editing.type === "event" ? "events" : editing.type === "task" ? "tasks" : "reminders";
    try {
      const response = await fetch(
        `/api/${collection}/${encodeURIComponent(editing.item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));
      setConfirmDelete(false);
      onOpenChange(false);
      await onDeleted();
    } catch (deleteError) {
      setConfirmDelete(false);
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The item could not be deleted.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="item-dialog">
          <DialogHeader>
            <div className="dialog-kicker">
              {type === "task" ? <ListTodo aria-hidden="true" /> : null}
              {type === "reminder" ? <Bell aria-hidden="true" /> : null}
              {type === "event" ? <CalendarDays aria-hidden="true" /> : null}
              <span>{editing ? "UPDATE YOUR PLAN" : "MAKE SPACE FOR IT"}</span>
            </div>
            <DialogTitle>{titleText}</DialogTitle>
            <DialogDescription>
              Times are saved in {YVONNE_TIME_ZONE}. WhatsApp alerts come from your Yvonne VPS.
            </DialogDescription>
          </DialogHeader>
          <form className="item-form" onSubmit={handleSubmit}>
            {!editing ? (
              <div className="field-stack">
                <Label htmlFor="item-type">What are you adding?</Label>
                <Select
                  onValueChange={(value) => {
                    if (value === "task" || value === "reminder" || value === "event") {
                      setType(value);
                    }
                  }}
                  value={type}
                >
                  <SelectTrigger id="item-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="task">Task</SelectItem>
                      <SelectItem value="reminder">Reminder or alarm</SelectItem>
                      <SelectItem value="event">Calendar event</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="field-stack">
              <Label htmlFor="item-title">Title</Label>
              <Input
                autoFocus
                id="item-title"
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  type === "task"
                    ? "e.g. Renew my passport"
                    : type === "reminder"
                      ? "e.g. Call Mum"
                      : "e.g. Project check-in"
                }
                required
                value={title}
              />
            </div>

            {type === "task" ? (
              <>
                <div className="field-stack">
                  <Label htmlFor="task-list">Task list</Label>
                  <Select onValueChange={(value) => value && setTaskListId(value)} value={taskListId}>
                    <SelectTrigger id="task-list" className="w-full">
                      <SelectValue placeholder="Choose a list" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {taskLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="field-stack">
                  <Label htmlFor="task-due">Due date and time (optional)</Label>
                  <Input
                    id="task-due"
                    onChange={(event) => setDueAt(event.target.value)}
                    type="datetime-local"
                    value={dueAt}
                  />
                </div>
                <div className="field-stack">
                  <Label htmlFor="task-notes">Notes</Label>
                  <Textarea
                    id="task-notes"
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    value={notes}
                  />
                </div>
                {dueAt ? (
                  <AlertSetting
                    alertEnabled={alertEnabled}
                    alertLeadMinutes={alertLeadMinutes}
                    onEnabledChange={setAlertEnabled}
                    onLeadChange={setAlertLeadMinutes}
                    prefix="Task due"
                  />
                ) : null}
              </>
            ) : null}

            {type === "reminder" ? (
              <>
                <div className="field-row">
                  <div className="field-stack">
                    <Label htmlFor="reminder-time">Remind me at</Label>
                    <Input
                      id="reminder-time"
                      onChange={(event) => setStartsAt(event.target.value)}
                      required
                      type="datetime-local"
                      value={startsAt}
                    />
                  </div>
                  <div className="field-stack">
                    <Label htmlFor="reminder-kind">Type</Label>
                    <Select
                      onValueChange={(value) => {
                        if (value === "reminder" || value === "alarm") setKind(value);
                      }}
                      value={kind}
                    >
                      <SelectTrigger id="reminder-kind" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="reminder">Reminder</SelectItem>
                          <SelectItem value="alarm">Alarm</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <RecurrenceSelect value={recurrence} onChange={setRecurrence} />
              </>
            ) : null}

            {type === "event" ? (
              <>
                <div className="field-row">
                  <div className="field-stack">
                    <Label htmlFor="event-start">Starts</Label>
                    <Input
                      id="event-start"
                      onChange={(event) => setStartsAt(event.target.value)}
                      required
                      type="datetime-local"
                      value={startsAt}
                    />
                  </div>
                  <div className="field-stack">
                    <Label htmlFor="event-end">Ends (optional)</Label>
                    <Input
                      id="event-end"
                      onChange={(event) => setEndsAt(event.target.value)}
                      type="datetime-local"
                      value={endsAt}
                    />
                  </div>
                </div>
                <label className="check-row" htmlFor="event-all-day">
                  <Checkbox
                    checked={allDay}
                    id="event-all-day"
                    onCheckedChange={(checked) => setAllDay(checked === true)}
                  />
                  <span>All-day event</span>
                </label>
                <RecurrenceSelect value={recurrence} onChange={setRecurrence} />
                {recurrence !== "once" ? (
                  <div className="field-stack">
                    <Label htmlFor="recurrence-until">Repeat until (optional)</Label>
                    <Input
                      id="recurrence-until"
                      onChange={(event) => setRecurrenceUntil(event.target.value)}
                      type="date"
                      value={recurrenceUntil}
                    />
                    <p className="field-help">Leave blank to repeat until you cancel it.</p>
                  </div>
                ) : null}
                <div className="field-stack">
                  <Label htmlFor="event-notes">Notes</Label>
                  <Textarea
                    id="event-notes"
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    value={notes}
                  />
                </div>
                <AlertSetting
                  alertEnabled={alertEnabled}
                  alertLeadMinutes={alertLeadMinutes}
                  onEnabledChange={setAlertEnabled}
                  onLeadChange={setAlertLeadMinutes}
                  prefix="Event"
                />
              </>
            ) : null}

            {type !== "task" || !dueAt ? (
              <div className="field-stack">
                <Label htmlFor="item-tags">Tags</Label>
                <Input
                  id="item-tags"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Work, family, health"
                  value={tags}
                />
                <p className="field-help">Separate tags with commas.</p>
              </div>
            ) : (
              <div className="field-stack">
                <Label htmlFor="item-tags">Tags</Label>
                <Input
                  id="item-tags"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Work, family, health"
                  value={tags}
                />
                <p className="field-help">Separate tags with commas.</p>
              </div>
            )}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not save this item</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter className="item-form-footer">
              {editing ? (
                <Button
                  className="delete-item-button"
                  disabled={pending}
                  onClick={() => setConfirmDelete(true)}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  Delete
                </Button>
              ) : null}
              <Button
                disabled={pending}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={pending || !title.trim()} type="submit">
                {pending ? "Saving..." : editing ? "Save changes" : "Create"}
                {!pending ? <Check data-icon="inline-start" aria-hidden="true" /> : null}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {editing?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Any WhatsApp alert linked to it will also be canceled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RecurrenceSelect({
  value,
  onChange,
}: {
  value: Recurrence;
  onChange: (value: Recurrence) => void;
}) {
  return (
    <div className="field-stack">
      <Label htmlFor="item-recurrence">Repeat</Label>
      <Select
        onValueChange={(nextValue) => {
          const option = recurrenceOptions.find((item) => item.value === nextValue);
          if (option) onChange(option.value);
        }}
        value={value}
      >
        <SelectTrigger id="item-recurrence" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {recurrenceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function AlertSetting({
  alertEnabled,
  alertLeadMinutes,
  onEnabledChange,
  onLeadChange,
  prefix,
}: {
  alertEnabled: boolean;
  alertLeadMinutes: string;
  onEnabledChange: (enabled: boolean) => void;
  onLeadChange: (minutes: string) => void;
  prefix: string;
}) {
  return (
    <div className="alert-setting">
      <label className="check-row" htmlFor="alert-enabled">
        <Checkbox
          checked={alertEnabled}
          id="alert-enabled"
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
        />
        <span>Send me a WhatsApp alert</span>
      </label>
      {alertEnabled ? (
        <div className="field-stack">
          <Label htmlFor="alert-lead">{prefix} alert timing</Label>
          <Select onValueChange={(value) => value && onLeadChange(value)} value={alertLeadMinutes}>
            <SelectTrigger id="alert-lead" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {alertLeadOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
