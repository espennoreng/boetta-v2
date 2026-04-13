import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireSuperadmin();
  } catch {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Admin — Approvals</h1>
      {children}
    </div>
  );
}
