import { Suspense } from "react";
import AuthPageClient from "@/components/auth/AuthPageClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="page-loading" style={{ minHeight: "40vh" }} />}>
      <AuthPageClient mode="login" />
    </Suspense>
  );
}
