import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.env.DEMO_ORG_SLUG ?? "demo-org";
  let org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Demo Organization",
        slug,
      },
    });
  }

  await prisma.orgQuota.upsert({
    where: { orgId: org.id },
    create: {
      orgId: org.id,
      dailyCrawlLimit: 200,
      dailyEmbedLimit: 1000,
    },
    update: {},
  });

  await prisma.subscription.upsert({
    where: { orgId: org.id },
    create: {
      orgId: org.id,
      plan: "free",
      status: "active",
    },
    update: {},
  });

  let user = await prisma.user.findUnique({ where: { email: "demo@local.test" } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: "demo@local.test" },
    });
  }

  await prisma.membership.upsert({
    where: {
      userId_orgId: { userId: user.id, orgId: org.id },
    },
    create: { userId: user.id, orgId: org.id, role: "owner" },
    update: {},
  });

  console.log("Seed OK:", { orgId: org.id, userId: user.id, slug: org.slug });
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
