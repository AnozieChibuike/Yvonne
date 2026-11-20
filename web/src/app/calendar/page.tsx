import { CalendarDashboard, type DashboardView } from "@/components/calendar-dashboard";
import { connection } from "next/server";

type CalendarPageProps = {
  searchParams: Promise<{ view?: string }>;
};

function parseDashboardView(value?: string): DashboardView {
  if (value === "tasks" || value === "reminders" || value === "events") return value;
  return "all";
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  await connection();
  const { view } = await searchParams;
  return (
    <CalendarDashboard
      initialNow={new Date().toISOString()}
      initialView={parseDashboardView(view)}
    />
  );
}
