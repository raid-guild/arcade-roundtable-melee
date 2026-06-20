import Link from "next/link";
import { portalModulesUrl } from "@/lib/session";

export default async function LaunchErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason = params.reason ?? "launch_failed";

  return (
    <main className="screen">
      <h1 className="title">ROUND FAILED</h1>
      <p className="subtitle">PORTAL LAUNCH WAS REJECTED</p>
      <p className="dim">Reason: {reason}</p>
      <Link className="coin" href={portalModulesUrl()}>
        BACK TO PORTAL
      </Link>
    </main>
  );
}
