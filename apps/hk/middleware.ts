import { NextResponse, type NextRequest } from "next/server";

/**
 * 多租户占位：生产环境可在此接入 Clerk / JWT，并校验 org 成员身份。
 * 当前开发模式使用 DEMO_ORG_SLUG（见 @learning-saas/db 的 getOrgContext）。
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("x-pathname", req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)"],
};
