import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentSidebar } from "./_components/agent-sidebar";
import { SessionsProvider } from "./_components/sessions-provider";

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionsProvider>
      <SidebarProvider>
        <AgentSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </SessionsProvider>
  );
}
