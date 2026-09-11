import { NextResponse } from "next/server";
import { getOrgContext, prisma } from "@learning-saas/db";
import { doubaoStructured } from "@/lib/doubao";

type PathStage = {
  id: string;
  name: string;
  goal: string;
  prerequisites: string[];
  tasks: string[];
  reviewPlan: string;
};

export async function GET() {
  const { orgId } = await getOrgContext();
  const tags = await prisma.knowledgeTag.findMany({
    where: { orgId },
    select: { id: true, name: true, _count: { select: { entries: true } } },
    orderBy: { entries: { _count: "desc" } },
    take: 12,
  });

  const top = tags.map((t) => ({ name: t.name, count: t._count.entries })).slice(0, 6);
  const ai = await doubaoStructured<{ stages: PathStage[]; milestones: string[] }>({
    prompt: `请基于以下知识主题为用户生成课程式学习路径，必须包含先修关系、阶段目标、任务和复习计划。\n仅输出 JSON：{"stages":[{"id":"","name":"","goal":"","prerequisites":[],"tasks":[],"reviewPlan":""}],"milestones":[]}\n主题数据:${JSON.stringify(top)}`,
    fallback: {
      stages: top.map((tag, idx) => ({
        id: `stage-${idx + 1}`,
        name: `${idx + 1}. ${tag.name}`,
        goal: `完成 ${tag.name} 的核心概念、案例与实操闭环，形成可复用的方法论。`,
        prerequisites: idx === 0 ? ["无"] : top.slice(0, idx).map((v) => v.name),
        tasks: [
          `补充至少 ${Math.max(2, 5 - Math.min(3, idx))} 条高质量资料并入库`,
          "整理一篇结构化总结（概念、流程、常见坑）",
          "输出一个可验证练习或小项目",
        ],
        reviewPlan: "首次学习后第 1/3/7 天复习，之后每周一次",
      })),
      milestones: [
        "第 1 周：完成体系盘点与优先级排序",
        "第 2~4 周：主攻前 2 个核心主题，边学边输出",
        "第 5~8 周：扩展到高阶主题并完成项目实践",
        "第 9~12 周：查漏补缺 + 面向目标场景复盘",
      ],
    },
    orgId,
    module: "learning_path",
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    stages: ai.stages,
    milestones: ai.milestones,
  });
}
