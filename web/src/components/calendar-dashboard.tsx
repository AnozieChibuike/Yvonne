"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  ArrowUpRight,
  Bell,
  Bot,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ListPlus,
  ListTodo,
  LogOut,
  Leaf,
  Plus,
} from "lucide-react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useRouter } from "next/navigation";
import type {
  CalendarData,
  CalendarEvent,
  ItemType,
  Reminder,
  Task,
  TaskList,
} from "@/lib/domain";
import { YVONNE_TIME_ZONE } from "@/lib/domain";
import { dateKeyToCalendarDate, formatLagosDateTime, toLagosDate } from "@/lib/time";
import { eventOccursOnDate, reminderOccursOnDate } from "@/lib/recurrence";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ItemDialog, type EditableRecord } from "@/components/item-dialog";

export type DashboardView = "all" | "tasks" | "reminders" | "events";
type View = DashboardView;
type DashboardItem =
  | { type: "task"; item: Task }
  | { type: "reminder"; item: Reminder }
  | { type: "event"; item: CalendarEvent };
type FocusItem = { type: string; id: string };
const EMPTY_LISTS: TaskList[] = [];

function monthStart(date: Date) {
  const month = formatInTimeZone(date, YVONNE_TIME_ZONE, "yyyy-MM");
  return dateKeyToCalendarDate(`${month}-01`);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-NG", {
    month: "long",
    year: "numeric",
    timeZone: YVONNE_TIME_ZONE,
  }).format(date);
}

function shiftMonth(date: Date, delta: number) {
  const [year, month] = formatInTimeZone(date, YVONNE_TIME_ZONE, "yyyy-MM")
    .split("-")
    .map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
  const key = shifted.toISOString().slice(0, 7);
  return dateKeyToCalendarDate(`${key}-01`);
}

function getDayTypeCount(items: DashboardItem[]) {
  return {
    tasks: items.filter((item) => item.type === "task").length,
    reminders: items.filter((item) => item.type === "reminder").length,
    events: items.filter((item) => item.type === "event").length,
  };
}

function localClock(date: Date) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: YVONNE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function itemDateKey(item: DashboardItem) {
  if (item.type === "task") return item.item.due_at ? toLagosDate(item.item.due_at) : null;
  if (item.type === "reminder") return toLagosDate(item.item.remind_at);
  return toLagosDate(item.item.starts_at);
}

function itemTimeOnDate(item: DashboardItem, dateKey: string) {
  if (item.type === "task") return new Date(item.item.due_at ?? 0).getTime();

  const timezone = item.item.timezone || YVONNE_TIME_ZONE;
  const timestamp = item.type === "reminder" ? item.item.remind_at : item.item.starts_at;
  const localTime =
    item.type === "reminder"
      ? item.item.local_time ?? formatInTimeZone(new Date(timestamp), timezone, "HH:mm")
      : formatInTimeZone(new Date(timestamp), timezone, "HH:mm");
  return fromZonedTime(`${dateKey}T${localTime}`, timezone).getTime();
}

function iconForItem(item: DashboardItem) {
  if (item.type === "task") return <ListTodo aria-hidden="true" />;
  if (item.type === "reminder" && item.item.kind === "alarm") {
    return <AlarmClock aria-hidden="true" />;
  }
  if (item.type === "reminder") return <Bell aria-hidden="true" />;
  return <CalendarDays aria-hidden="true" />;
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : "The request could not be completed.";
}

function toEditableRecord(type: string, value: unknown): EditableRecord | null {
  if (!value || typeof value !== "object") return null;
  if (type === "task") return { type, item: value as Task };
  if (type === "reminder") return { type, item: value as Reminder };
  if (type === "event") return { type, item: value as CalendarEvent };
  return null;
}

export function CalendarDashboard({
  initialNow,
  initialView = "all",
  focusItem,
}: {
  initialNow: string;
  initialView?: DashboardView;
  focusItem?: FocusItem;
}) {
  const router = useRouter();
  const initialDate = dateKeyToCalendarDate(toLagosDate(initialNow));
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(initialDate));
  const [view, setView] = useState<View>(initialView);
  const [mobileCalendarExpanded, setMobileCalendarExpanded] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [createType, setCreateType] = useState<ItemType>("event");
  const [editing, setEditing] = useState<EditableRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [focusedRecord, setFocusedRecord] = useState<EditableRecord | null>(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [listError, setListError] = useState("");
  const [listPending, setListPending] = useState(false);
  const [now, setNow] = useState(initialNow);

  const taskLists = data?.taskLists ?? EMPTY_LISTS;
  const selectedDateKey = formatInTimeZone(selectedDate, YVONNE_TIME_ZONE, "yyyy-MM-dd");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/calendar", { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      }
      throw new Error(await responseError(response));
    }
    const result: CalendarData = await response.json();
    setData(result);
    setError("");
    return result;
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadCalendar() {
      try {
        const response = await fetch("/api/calendar", { cache: "no-store" });
        if (!response.ok) {
          if (response.status === 401) {
            router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          }
          throw new Error(await responseError(response));
        }
        const result: CalendarData = await response.json();
        if (!active) return;
        setData(result);
        setError("");
      } catch (loadError: unknown) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Yvonne could not load your calendar.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadCalendar();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!focusItem) return;
    let active = true;
    fetch(`/api/items/${encodeURIComponent(focusItem.type)}/${encodeURIComponent(focusItem.id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json();
      })
      .then((result) => {
        if (!active) return;
        const record = toEditableRecord(result.type, result.item);
        if (!record) throw new Error("This Yvonne item link is invalid.");
        setFocusedRecord(record);
        const key = itemDateKey(record);
        if (key) {
          const date = dateKeyToCalendarDate(key);
          setSelectedDate(date);
          setVisibleMonth(monthStart(date));
        }
      })
      .catch((focusError: unknown) => {
        if (active) setError(focusError instanceof Error ? focusError.message : "Could not load this item.");
      });
    return () => {
      active = false;
    };
  }, [focusItem]);

  const getDayItems = useCallback(
    (dateKey: string): DashboardItem[] => {
      if (!data) return [];
      const tasks = data.tasks
        .filter(
          (task) =>
            task.status === "open" &&
            task.due_at &&
            toLagosDate(task.due_at) === dateKey &&
            (!selectedListId || task.task_list_id === selectedListId),
        )
        .map((item) => ({ type: "task" as const, item }));
      const reminders = data.reminders
        .filter((reminder) => reminderOccursOnDate(reminder, dateKey))
        .map((item) => ({ type: "reminder" as const, item }));
      const events = data.events
        .filter((event) => eventOccursOnDate(event, dateKey))
        .map((item) => ({ type: "event" as const, item }));
      return [...tasks, ...reminders, ...events].sort((a, b) => {
        return itemTimeOnDate(a, dateKey) - itemTimeOnDate(b, dateKey);
      });
    },
    [data, selectedListId],
  );

  const selectedItems = getDayItems(selectedDateKey);
  const selectedCounts = getDayTypeCount(selectedItems);
  const panelItems = useMemo((): DashboardItem[] => {
    if (!data) return [];
    if (view === "tasks") {
      return data.tasks
        .filter((task) => !selectedListId || task.task_list_id === selectedListId)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "open" ? -1 : 1;
          if (!a.due_at) return b.due_at ? 1 : 0;
          if (!b.due_at) return -1;
          return a.due_at.localeCompare(b.due_at);
        })
        .map((item) => ({ type: "task" as const, item }));
    }
    if (view === "reminders") {
      return [...data.reminders]
        .sort((a, b) => a.remind_at.localeCompare(b.remind_at))
        .map((item) => ({ type: "reminder" as const, item }));
    }
    if (view === "events") {
      return [...data.events]
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((item) => ({ type: "event" as const, item }));
    }
    return selectedItems;
  }, [data, selectedItems, selectedListId, view]);

  const currentTitle =
    view === "tasks"
      ? "Your tasks"
      : view === "reminders"
        ? "Reminders"
        : view === "events"
          ? "Calendar events"
          : "Your day";

  function openCreate(type: ItemType) {
    setCreateType(type);
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(item: DashboardItem) {
    setEditing(item);
    setCreateType(item.type);
    setEditorOpen(true);
  }

  async function handleSaved(warning?: string | null) {
    setNotice(warning || "Saved to your calendar.");
    setFocusedRecord(null);
    await refresh();
  }

  async function handleDeleted() {
    setNotice("Item deleted. Its linked WhatsApp alert was canceled.");
    setFocusedRecord(null);
    await refresh();
  }

  async function toggleTask(task: Task) {
    setError("");
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: task.status === "open" ? "completed" : "open" }),
    });
    if (!response.ok) {
      setError(await responseError(response));
      return;
    }
    setNotice(task.status === "open" ? "Task completed." : "Task reopened.");
    await refresh();
  }

  async function addTaskList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setListPending(true);
    setListError("");
    const response = await fetch("/api/task-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName }),
    });
    if (!response.ok) {
      setListError(await responseError(response));
      setListPending(false);
      return;
    }
    const list: TaskList = await response.json();
    setNewListName("");
    setListDialogOpen(false);
    setSelectedListId(list.id);
    setView("tasks");
    setNotice(`Created the ${list.name} list.`);
    setListPending(false);
    await refresh();
  }

  async function signOut() {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/browser");
    const supabase = createSupabaseBrowserClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError("Could not sign out. Please try again.");
      console.error("Yvonne web sign-out failed:", signOutError.message);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  const selectedDateLabel = new Intl.DateTimeFormat("en-NG", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: YVONNE_TIME_ZONE,
  }).format(selectedDate);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Bot aria-hidden="true" />
          </div>
          <div>
            <span className="brand-name">yvonne</span>
            <span className="brand-caption">PERSONAL ASSISTANT</span>
          </div>
        </div>

        <div className="sidebar-section-label">Workspace</div>
        <nav aria-label="Workspace views" className="primary-nav">
          <NavButton
            active={view === "all"}
            icon={<CalendarDays aria-hidden="true" />}
            label="Calendar"
            onClick={() => setView("all")}
          />
          <NavButton
            active={view === "tasks"}
            count={data?.tasks.filter((task) => task.status === "open").length}
            icon={<ListTodo aria-hidden="true" />}
            label="Tasks"
            onClick={() => setView("tasks")}
          />
          <NavButton
            active={view === "reminders"}
            count={data?.reminders.length}
            icon={<Bell aria-hidden="true" />}
            label="Reminders"
            onClick={() => setView("reminders")}
          />
          <NavButton
            active={view === "events"}
            icon={<CalendarPlus aria-hidden="true" />}
            label="Events"
            onClick={() => setView("events")}
          />
        </nav>

        <div className="task-list-heading">
          <span className="sidebar-section-label">Task lists</span>
          <Button
            aria-label="Create task list"
            onClick={() => setListDialogOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <ListPlus aria-hidden="true" />
          </Button>
        </div>
        <div className="task-list-nav">
          <button
            className={`task-list-link ${selectedListId === null && view === "tasks" ? "active" : ""}`}
            onClick={() => {
              setSelectedListId(null);
              setView("tasks");
            }}
            type="button"
          >
            <span className="list-color-dot list-color-all" />
            <span>All lists</span>
            <span className="list-count">
              {data?.tasks.filter((task) => task.status === "open").length ?? 0}
            </span>
          </button>
          {taskLists.map((list, index) => (
            <button
              className={`task-list-link ${selectedListId === list.id && view === "tasks" ? "active" : ""}`}
              key={list.id}
              onClick={() => {
                setSelectedListId(list.id);
                setView("tasks");
              }}
              type="button"
            >
              <span className={`list-color-dot list-color-${index % 4}`} />
              <span className="task-list-name">{list.name}</span>
              <span className="list-count">
                {data?.tasks.filter(
                  (task) => task.task_list_id === list.id && task.status === "open",
                ).length ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="timezone-card">
            <div className="timezone-icon">
              <Clock3 aria-hidden="true" />
            </div>
            <div>
              <span className="timezone-label">Lagos time</span>
              <span className="timezone-value">{localClock(new Date(now))} WAT</span>
            </div>
            <span className="online-indicator" />
          </div>
          <Button className="signout-button" onClick={signOut} variant="ghost">
            <LogOut data-icon="inline-start" aria-hidden="true" />
            Sign out
          </Button>
          <div className="sidebar-user">
            <div className="user-avatar">Y</div>
            <div>
              <span className="user-name">Your private space</span>
              <span className="user-caption">Only you can access this</span>
            </div>
          </div>
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">
              {new Intl.DateTimeFormat("en-NG", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: YVONNE_TIME_ZONE,
              }).format(new Date(now))}
            </p>
            <h1>{view === "all" ? "A little more in rhythm." : currentTitle}</h1>
            <p className="header-subtitle">
              {view === "all"
                ? "Your tasks, reminders, and plans in one calm place."
                : "Everything you need, thoughtfully in one place."}
            </p>
          </div>
          <div className="header-actions">
            <Button onClick={() => openCreate("task")} variant="outline">
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add task
            </Button>
            <Button onClick={() => openCreate(view === "reminders" ? "reminder" : "event")}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              New item
            </Button>
          </div>
        </header>

        {error ? (
          <Alert className="dashboard-alert" variant="destructive">
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert className="dashboard-notice">
            <CheckCheck aria-hidden="true" />
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        ) : null}

        <div className="dashboard-grid">
          <Card className="calendar-card">
            <CardHeader className="calendar-card-header">
              <div>
                <p className="eyebrow">YOUR OVERVIEW</p>
                <CardTitle>{monthLabel(visibleMonth)}</CardTitle>
              </div>
              <div className="calendar-controls">
                <Button
                  aria-label="Previous month"
                  onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  className="calendar-today-button"
                  onClick={() => {
                    const today = dateKeyToCalendarDate(toLagosDate(new Date()));
                    setSelectedDate(today);
                    setVisibleMonth(monthStart(today));
                    setMobileCalendarExpanded(false);
                  }}
                  size="sm"
                  variant="outline"
                >
                  Today
                </Button>
                <Button
                  aria-label="Next month"
                  onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}
                  size="icon"
                  variant="ghost"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                  aria-controls="calendar-month-grid"
                  aria-expanded={mobileCalendarExpanded}
                  className="calendar-toggle"
                  onClick={() => setMobileCalendarExpanded((expanded) => !expanded)}
                  size="sm"
                  variant="outline"
                >
                  {mobileCalendarExpanded ? "Hide dates" : "Choose date"}
                  <ChevronDown aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent
              aria-label="Calendar dates"
              className={`calendar-card-content${mobileCalendarExpanded ? "" : " calendar-mobile-collapsed"}`}
              id="calendar-month-grid"
            >
              {loading ? (
                <div className="calendar-loading">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : (
                <Calendar
                  className="yvonne-calendar"
                  fixedWeeks
                  mode="single"
                  modifiers={{
                    hasItems: (date) =>
                      getDayItems(formatInTimeZone(date, YVONNE_TIME_ZONE, "yyyy-MM-dd")).length > 0,
                  }}
                  modifiersClassNames={{ hasItems: "calendar-has-items" }}
                  month={visibleMonth}
                  onMonthChange={setVisibleMonth}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setVisibleMonth(monthStart(date));
                      setMobileCalendarExpanded(false);
                    }
                  }}
                  selected={selectedDate}
                  timeZone={YVONNE_TIME_ZONE}
                  weekStartsOn={1}
                  components={{
                    DayButton: (props) => {
                      const dateKey = formatInTimeZone(
                        props.day.date,
                        YVONNE_TIME_ZONE,
                        "yyyy-MM-dd",
                      );
                      const counts = getDayTypeCount(getDayItems(dateKey));
                      return (
                        <CalendarDayButton
                          {...props}
                          className="calendar-day-button"
                        >
                          <span className="calendar-day-number">
                            {formatInTimeZone(props.day.date, YVONNE_TIME_ZONE, "d")}
                          </span>
                          <span aria-hidden="true" className="calendar-dots">
                            {counts.tasks ? <span className="calendar-dot task-dot" /> : null}
                            {counts.reminders ? <span className="calendar-dot reminder-dot" /> : null}
                            {counts.events ? <span className="calendar-dot event-dot" /> : null}
                          </span>
                        </CalendarDayButton>
                      );
                    },
                  }}
                />
              )}
              <div className="calendar-legend">
                <LegendItem color="task-dot" label="Tasks" />
                <LegendItem color="reminder-dot" label="Reminders" />
                <LegendItem color="event-dot" label="Events" />
              </div>
            </CardContent>
          </Card>

          <Card className="agenda-card">
            <CardHeader className="agenda-header">
              <div>
                <p className="eyebrow">{view === "all" ? "ON THIS DAY" : "YOUR COLLECTION"}</p>
                <CardTitle>{view === "all" ? selectedDateLabel : currentTitle}</CardTitle>
              </div>
              <Badge variant="secondary">{panelItems.length} items</Badge>
            </CardHeader>
            <CardContent className="agenda-content">
              {focusedRecord ? (
                <FocusedItem
                  onClose={() => {
                    setFocusedRecord(null);
                    router.push("/calendar");
                  }}
                  onEdit={() => openEdit(focusedRecord)}
                  record={focusedRecord}
                />
              ) : null}
              {!data && loading ? (
                <div className="agenda-loading">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : panelItems.length ? (
                <div className="agenda-list">
                  {panelItems.map((item) => (
                    <AgendaItem
                      key={`${item.type}-${item.item.id}`}
                      item={item}
                      onComplete={item.type === "task" ? () => void toggleTask(item.item) : undefined}
                      onOpen={() => openEdit(item)}
                      selectedListName={
                        item.type === "task"
                          ? taskLists.find((list) => list.id === item.item.task_list_id)?.name
                          : undefined
                      }
                      view={view}
                    />
                  ))}
                </div>
              ) : (
                <Empty className="agenda-empty">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {view === "tasks" ? <ListTodo aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {view === "all" ? "A clear day ahead" : `No ${view} yet`}
                    </EmptyTitle>
                    <EmptyDescription>
                      {view === "all"
                        ? "Add something when it matters. Tasks without a due date stay in your task lists."
                        : "Create one whenever you are ready. Yvonne will keep it here."}
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button
                    onClick={() =>
                      openCreate(view === "tasks" ? "task" : view === "reminders" ? "reminder" : "event")
                    }
                    size="sm"
                  >
                    <Plus data-icon="inline-start" aria-hidden="true" />
                    Add {view === "all" ? "an item" : view === "events" ? "an event" : view.slice(0, -1)}
                  </Button>
                </Empty>
              )}

              {view === "all" && selectedItems.length > 0 ? (
                <div className="day-summary">
                  <span>{selectedCounts.tasks} tasks</span>
                  <span>{selectedCounts.reminders} reminders</span>
                  <span>{selectedCounts.events} events</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="bottom-grid">
          <Card className="focus-card">
            <CardContent className="focus-content">
              <div className="focus-icon">
                <Leaf aria-hidden="true" />
              </div>
              <div>
                <p className="eyebrow">A GENTLE NUDGE</p>
                <h2>Make room for what matters.</h2>
                <p>Tasks can be undated. Reminders and events stay separate, with alerts sent by WhatsApp.</p>
              </div>
              <Button onClick={() => openCreate("reminder")} variant="outline">
                <Bell data-icon="inline-start" aria-hidden="true" />
                Set a reminder
              </Button>
            </CardContent>
          </Card>
          <Card className="quick-add-card">
            <CardHeader>
              <p className="eyebrow">QUICK ADD</p>
              <CardTitle>Start with one thing</CardTitle>
            </CardHeader>
            <CardContent className="quick-add-actions">
              <QuickAddButton
                icon={<ListTodo aria-hidden="true" />}
                label="Task"
                onClick={() => openCreate("task")}
              />
              <QuickAddButton
                icon={<Bell aria-hidden="true" />}
                label="Reminder"
                onClick={() => openCreate("reminder")}
              />
              <QuickAddButton
                icon={<CalendarDays aria-hidden="true" />}
                label="Event"
                onClick={() => openCreate("event")}
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <ItemDialog
        key={`${editorOpen}:${editing?.type ?? createType}:${editing?.item.id ?? ""}`}
        createType={createType}
        editing={editing}
        initialDate={selectedDateKey}
        onDeleted={handleDeleted}
        onOpenChange={setEditorOpen}
        onSaved={handleSaved}
        open={editorOpen}
        taskLists={taskLists}
      />
      <Dialog
        open={listDialogOpen}
        onOpenChange={(open) => {
          setListDialogOpen(open);
          if (!open) setListError("");
        }}
      >
        <DialogContent className="task-list-dialog">
          <DialogHeader>
            <div className="dialog-kicker">
              <ListPlus aria-hidden="true" />
              <span>MAKE IT YOURS</span>
            </div>
            <DialogTitle>Create a task list</DialogTitle>
            <DialogDescription>Keep different parts of your life organized.</DialogDescription>
          </DialogHeader>
          <form className="item-form" onSubmit={addTaskList}>
            <div className="field-stack">
              <Label htmlFor="task-list-name">List name</Label>
              <Input
                autoFocus
                id="task-list-name"
                maxLength={60}
                onChange={(event) => setNewListName(event.target.value)}
                placeholder="e.g. Home, Work, Personal"
                required
                value={newListName}
              />
            </div>
            {listError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not create list</AlertTitle>
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter className="item-form-footer">
              <Button onClick={() => setListDialogOpen(false)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={listPending || !newListName.trim()} type="submit">
                {listPending ? "Creating..." : "Create list"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function NavButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} type="button">
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </button>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="legend-item">
      <span className={`calendar-dot ${color}`} />
      <span>{label}</span>
    </div>
  );
}

function AgendaItem({
  item,
  onOpen,
  onComplete,
  selectedListName,
  view,
}: {
  item: DashboardItem;
  onOpen: () => void;
  onComplete?: () => void;
  selectedListName?: string;
  view: View;
}) {
  const typeLabel =
    item.type === "reminder" && item.item.kind === "alarm"
      ? "Alarm"
      : item.type === "event"
        ? item.item.recurrence === "once"
          ? "Event"
          : `Repeats ${item.item.recurrence}`
        : item.type === "reminder"
          ? item.item.recurrence === "once"
            ? "Reminder"
            : `Repeats ${item.item.recurrence}`
          : item.item.status === "completed"
            ? "Completed"
            : selectedListName || "Task";
  const subtitle =
    item.type === "task"
      ? item.item.due_at
        ? formatLagosDateTime(item.item.due_at)
        : "No due date"
      : item.type === "reminder"
        ? formatLagosDateTime(item.item.remind_at)
        : item.item.all_day
          ? `All day · ${formatLagosDateTime(item.item.starts_at, { timeStyle: undefined })}`
          : formatLagosDateTime(item.item.starts_at);

  return (
    <div className={`agenda-item agenda-${item.type} ${item.type === "task" && item.item.status === "completed" ? "is-complete" : ""}`}>
      {item.type === "task" ? (
        <Button
          aria-label={item.item.status === "open" ? "Complete task" : "Reopen task"}
          className="task-complete-button"
          onClick={onComplete}
          size="icon"
          variant="ghost"
        >
          {item.item.status === "open" ? <Circle aria-hidden="true" /> : <Check aria-hidden="true" />}
        </Button>
      ) : (
        <span className={`agenda-item-icon ${item.type}`}>{iconForItem(item)}</span>
      )}
      <button className="agenda-item-main" onClick={onOpen} type="button">
        <span className="agenda-item-title">{item.item.title}</span>
        <span className="agenda-item-subtitle">{subtitle}</span>
      </button>
      <div className="agenda-item-side">
        <Badge variant="outline">{typeLabel}</Badge>
        <Button
          aria-label={`Open ${item.type}`}
          className="agenda-open-button"
          onClick={onOpen}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowUpRight aria-hidden="true" />
        </Button>
      </div>
      {view === "all" && item.type === "event" && item.item.tags.length ? (
        <div className="agenda-item-tags">
          {item.item.tags.slice(0, 3).map((tag) => (
            <span className="tag-chip" key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FocusedItem({
  record,
  onEdit,
  onClose,
}: {
  record: EditableRecord;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="focused-item">
      <div className="focused-item-heading">
        <Badge variant="secondary">Opened from WhatsApp</Badge>
        <Button onClick={onClose} size="sm" variant="ghost">Close</Button>
      </div>
      <div className="focused-item-title">
        <span className={`agenda-item-icon ${record.type}`}>
          {record.type === "task" ? <ListTodo aria-hidden="true" /> : record.type === "reminder" ? <Bell aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
        </span>
        <div>
          <h3>{record.item.title}</h3>
          <p>
            {record.type === "task"
              ? record.item.due_at
                ? formatLagosDateTime(record.item.due_at)
                : "No due date"
              : record.type === "reminder"
                ? formatLagosDateTime(record.item.remind_at)
                : formatLagosDateTime(record.item.starts_at)}
          </p>
        </div>
      </div>
      {record.type !== "reminder" && record.item.notes ? (
        <p className="focused-item-notes">{record.item.notes}</p>
      ) : null}
      <Button onClick={onEdit} size="sm" variant="outline">Open details</Button>
    </div>
  );
}

function QuickAddButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="quick-add-button" onClick={onClick} type="button">
      <span>{icon}</span>
      <span>{label}</span>
      <Plus aria-hidden="true" />
    </button>
  );
}
