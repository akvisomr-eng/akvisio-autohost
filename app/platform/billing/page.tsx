import { redirect } from "next/navigation";
import PlatformBillingWorkspace from "@/app/platform/platform-billing-workspace";
import { getPlatformSession } from "@/lib/platform-auth";

export const dynamic = "force-dynamic";

export default async function PlatformBillingPage() {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return <PlatformBillingWorkspace />;
}
