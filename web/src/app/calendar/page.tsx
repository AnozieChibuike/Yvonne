import { CalendarDashboard } from "@/components/calendar-dashboard";
import { connection } from "next/server";

export default async function CalendarPage() {
  await connection();
  return <CalendarDashboard initialNow={new Date().toISOString()} />;
}
