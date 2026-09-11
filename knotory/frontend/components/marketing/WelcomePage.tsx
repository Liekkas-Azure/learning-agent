"use client";

import Link from "next/link";
import { useState } from "react";
import CloudDemoStrip from "@/components/CloudDemoStrip";
import { completeOnboarding } from "@/lib/onboarding";
import { enableDemoMode } from "@/lib/productPrefs";
import { getCloudDemoUrl } from "@/lib/cloudDemo";

const pillars = [
  {
    title: "你的材料，值得信任",
    desc: "只从你上传的 PDF、Markdown 等材料拆知识点；学完可导出闪卡、笔记与文库备份。",
  },
  {
    title: "懂你偏好的讲法",
    desc: "大模型结合知识体系与你的刷读反馈，记住偏好的类比、分步或零基础讲法；不懂就换讲法直到搞懂。",
  },
  {
    title: "随时随地轻量学习",
    desc: "推荐流像刷短视频；每日目标、摘要与学习路径帮你在碎片时间也能推进，不必坐定深读。",
  },
  {
    title: "保存映射",
    desc: "搞懂后保存，与原文片段绑定；相关内容再来，优先唤起你认可的那张卡。",
  },
];

const steps = [
  { n: "1", title: "上传你的文库", text: "材料只来自你，建立可信任的知识来源。" },
  { n: "2", title: "按偏好讲清楚", text: "系统拆卡并重写，贴合你最容易理解的讲法。" },
  { n: "3", title: "轻量刷推荐流", text: "每日目标 + 摘要，碎片时间也能学。" },
  { n: "4", title: "保存并导出", text: "搞懂后保存映射；随时导出笔记与闪卡带走。" },
];

const pricing = [
  {
    id: "cloud",
    name: "Cloud 版",
    price: "免费试用",
    period: "",
    highlight: true,
    tagline: "浏览器即用，文库与闪卡保存在云端，无需本地知识库。",
    features: [
      "文库上传、知识点闪卡、推荐流与保存映射",
      "跨设备登录，笔记与复习进度同步",
      "一键导出闪卡、笔记与文库备份 zip",
      "拆卡与重写由云端模型完成",
    ],
    cta: "开始使用",
    href: "/library",
  },
  {
    id: "supporter",
    name: "早鸟支持者",
    price: "¥68",
    period: "/ 年",
    highlight: false,
    tagline: "帮助 Knotory 持续迭代；优先入群与功能投票权。",
    features: [
      "含 Cloud 版全部能力",
      "微信社群优先答疑与路线图投票",
      "新功能内测优先体验",
      "支持发票（个人），7 天内可退款",
    ],
    cta: "加入早鸟等候名单",
    href: "#community-supporter",
  },
  {
    id: "selfhost",
    name: "自托管",
    price: "¥0",
    period: "开源",
    highlight: false,
    tagline: "适合开发者自行部署到私有服务器（见 DEPLOY.md）。",
    features: [
      "与 Cloud 相同的核心能力",
      "自备模型 API 与对象存储",
      "Docker Compose 一键部署",
      "数据完全由你掌控",
    ],
    cta: "了解自托管",
    href: "#community-selfhost",
  },
];

const faqs = [
  {
    q: "和 Anki / Obsidian 有什么区别？",
    a: "Anki 需自己制卡，Obsidian 擅长存档深读。Knotory 从你的文库拆知识点、写易懂闪卡；刷懂后保存，相关内容再来时直接弹出你认可的那张卡。",
  },
  {
    q: "闪卡是原文摘抄吗？",
    a: "不是。闪卡按「好理解、好记忆」重写知识点。若仍看不懂，点「重写」说明讲法方向，调到懂再保存。",
  },
  {
    q: "数据存在哪里？",
    a: "默认保存在 Knotory 云端账号下，无需在本地维护知识库文件夹。你可在文库「导出」区下载闪卡 Markdown、笔记汇总，或整包文库 zip 备份。",
  },
  {
    q: "没有 API Key 能用吗？",
    a: "Cloud 版已配置模型，注册登录即可上传、拆卡与重写。自托管部署需自行配置 ARK 或兼容接口。",
  },
  {
    q: "适合谁？",
    a: "囤了大量材料、想真正搞懂而不只是存档的自学者、考证党与研究生。",
  },
];

export default function WelcomePage() {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  const markStarted = () => completeOnboarding();

  const onJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      const { submitWaitlistEmail } = await import("@/lib/api");
      await submitWaitlistEmail(email.trim(), "welcome");
      setJoined(true);
      try {
        localStorage.setItem("knotory_waitlist_emails", JSON.stringify([email.trim()]));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "登记失败");
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="welcome">
      <section className="welcome-hero">
        <p className="welcome-hero__eyebrow">文库 · 知识点闪卡</p>
        <h1 className="welcome-hero__title">
          上传文库，
          <br />
          <span className="welcome-hero__accent">刷懂</span> 每一个知识点
        </h1>
        <p className="welcome-hero__lead">
          把长文拆成易懂闪卡，在推荐流里逐个刷懂。看不懂就按方向重写，搞懂后保存——以后相关内容出现，直接弹出你认可的那张卡。
        </p>
        <div className="welcome-hero__actions">
          <Link href="/library" className="btn btn-primary btn-lg" onClick={markStarted}>
            上传文库 · 开始拆知识点
          </Link>
          <Link
            href="/"
            className="btn btn-secondary btn-lg"
            onClick={() => {
              enableDemoMode();
              markStarted();
            }}
          >
            先刷示例卡
          </Link>
          <Link href="/" className="btn btn-ghost btn-sm" onClick={markStarted}>
            进入推荐流
          </Link>
          {getCloudDemoUrl() ? (
            <a href={getCloudDemoUrl()!} className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">
              云端试用
            </a>
          ) : null}
        </div>
        <CloudDemoStrip />
        <p className="welcome-hero__note">闪卡为理解而写，不是原文摘抄</p>
      </section>

      <section className="welcome-section" id="how">
        <h2 className="welcome-section__title">四步：从上传到搞懂</h2>
        <div className="welcome-steps">
          {steps.map((s) => (
            <article key={s.n} className="welcome-step">
              <span className="welcome-step__n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section">
        <h2 className="welcome-section__title">产品怎么帮你搞懂</h2>
        <p className="welcome-section__sub">文库是起点，推荐流是主战场，保存映射让知识点跟着你走。</p>
        <div className="welcome-pillars">
          {pillars.map((p) => (
            <article key={p.title} className="welcome-pillar">
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-section--audience">
        <h2 className="welcome-section__title">为谁而做</h2>
        <div className="welcome-audience">
          <div>
            <h3>✓ 很适合</h3>
            <ul>
              <li>材料以 PDF、Markdown 为主，想搞懂而不只是存档</li>
              <li>看过很多遍仍记不住，需要「刷知识点」而不是重读全文</li>
              <li>希望保存搞懂后的闪卡，相关内容再来时能直接唤起</li>
              <li>能接受一次性配置 API Key（火山方舟等）</li>
            </ul>
          </div>
          <div>
            <h3>✗ 暂不适合</h3>
            <ul>
              <li>只想和 AI 闲聊查资料（问答页为辅助，主路径是刷知识点）</li>
              <li>完全不想配置 API，也不打算自托管</li>
              <li>纯手机端刷短视频式学习（当前偏桌面体验）</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="welcome-section" id="pricing">
        <h2 className="welcome-section__title">定价</h2>
        <p className="welcome-section__sub">C 端个人使用；团队内网部署见文档。</p>
        <div className="welcome-pricing">
          {pricing.map((plan) => (
            <article
              key={plan.id}
              className={`welcome-plan${plan.highlight ? " welcome-plan--highlight" : ""}`}
            >
              {plan.highlight ? <span className="welcome-plan__badge">推荐</span> : null}
              <h3 className="welcome-plan__name">{plan.name}</h3>
              <p className="welcome-plan__price">
                {plan.price}
                {plan.period ? <span>{plan.period}</span> : null}
              </p>
              <p className="welcome-plan__tagline">{plan.tagline}</p>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link href={plan.href} className={`btn ${plan.highlight ? "btn-primary" : "btn-secondary"}`}>
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
        <p className="welcome-pricing__fine">
          LLM 调用费用按火山方舟 / 兼容服务商账单另计。软件本身不收费，不收集你的文库内容。
        </p>
      </section>

      <section className="welcome-section" id="community">
        <h2 className="welcome-section__title">社群与更新</h2>
        <div className="welcome-community">
          <div className="welcome-community__card" id="community-supporter">
            <h3>微信早鸟群</h3>
            <p>产品更新、刷读技巧与 API 配置互助。支持者优先入群；可登记等候名单。</p>
            <form className="welcome-waitlist" onSubmit={onJoinWaitlist}>
              <input
                type="email"
                placeholder="你的邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="邮箱"
                required
              />
              <button type="submit" className="btn btn-primary" disabled={joined || joinBusy}>
                {joined ? "已登记" : joinBusy ? "提交中…" : "登记"}
              </button>
            </form>
            {joinError ? <p className="welcome-waitlist__hint welcome-waitlist__hint--err">{joinError}</p> : null}
            <p className="welcome-waitlist__hint">邮箱保存在服务端数据库，用于早鸟群邀请与 Cloud 首发通知。</p>
          </div>
          <div className="welcome-community__card" id="community-cloud">
            <h3>开源与反馈</h3>
            <ul className="welcome-links">
              <li>
                <Link href="/library" onClick={markStarted}>文库 · 上传第一份材料</Link>
              </li>
              <li>
                <Link href="/" onClick={markStarted}>推荐流 · 开始刷知识点</Link>
              </li>
              <li>
                <span className="welcome-links__muted">Issue / 功能建议：在 monorepo 的 knotory 目录提交</span>
              </li>
            </ul>
            <p className="welcome-community__channels">
              内容渠道：即刻 / 小红书搜索「Knotory 闪卡」「文库刷知识点」。
            </p>
          </div>
        </div>
      </section>

      <section className="welcome-section">
        <h2 className="welcome-section__title">常见问题</h2>
        <dl className="welcome-faq">
          {faqs.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="welcome-cta">
        <h2>上传文库，刷懂第一批知识点</h2>
        <Link href="/library" className="btn btn-primary btn-lg" onClick={markStarted}>
          去文库上传
        </Link>
      </section>
    </div>
  );
}
