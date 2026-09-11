import { HkDashboardClient } from "@/components/hk/HkDashboardClient";

export default function HkQuantDashboardPage() {
  return (
    <div className="min-h-[calc(100dvh-5rem)] rounded-2xl border border-cyan-500/10 bg-gradient-to-b from-[#070b14] via-[#050810] to-[#080612] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-1.5">
      <div className="rounded-[14px] border border-white/[0.06] bg-[#050810]/75 p-3 backdrop-blur-md sm:p-5">
        <HkDashboardClient />
      </div>
    </div>
  );
}
