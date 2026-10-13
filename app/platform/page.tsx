import { redirect } from "next/navigation";
import PlatformConsole from "@/app/platform/platform-console";
import { getPlatformSession } from "@/lib/platform-auth";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return <PlatformConsole fullName={session.fullName} email={session.email} />;
}
