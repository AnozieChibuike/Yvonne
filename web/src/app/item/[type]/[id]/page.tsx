import { CalendarDashboard } from "@/components/calendar-dashboard";
import { connection } from "next/server";

type ItemPageProps = {
  params: Promise<{ type: string; id: string }>;
};

export default async function ItemPage({ params }: ItemPageProps) {
  await connection();
  return (
    <CalendarDashboard
      focusItem={await params}
      initialNow={new Date().toISOString()}
    />
  );
}
