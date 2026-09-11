import { Suspense } from "react";
import AuthPageClient from "@/components/auth/AuthPageClient";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="page-loading" style={{ minHeight: "40vh" }} />}>
      <AuthPageClient mode="register" />
    </Suspense>
  );
}
