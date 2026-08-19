import { getAllFunds } from "@/lib/data";
import ScreenerClient from "@/components/ScreenerClient";

export const dynamic = "force-static";
export const metadata = { title: "Screener · KOSPI 200" };

export default function ScreenerPage() {
  const funds = getAllFunds();
  return <ScreenerClient funds={funds} />;
}
