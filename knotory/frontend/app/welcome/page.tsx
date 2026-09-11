import type { Metadata } from "next";
import WelcomePage from "@/components/marketing/WelcomePage";

export const metadata: Metadata = {
  title: "Knotory — 上传文库，刷懂知识点",
  description:
    "上传文库，拆成易懂闪卡，推荐流逐个刷懂；搞懂后保存映射，相关内容再来时弹出你认可的那张卡。",
  robots: { index: true, follow: true },
};

export default function WelcomeRoute() {
  return (
    <main className="welcome-page">
      <WelcomePage />
    </main>
  );
}
