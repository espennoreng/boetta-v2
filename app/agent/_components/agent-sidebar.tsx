"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { PlusIcon, MessageSquareIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSessions } from "./sessions-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AgentSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sessions, loading } = useSessions();
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => router.push("/agent")}
              tooltip="Ny samtale"
            >
              <PlusIcon />
              <span>Ny samtale</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Samtaler</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {loading && sessions.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    Laster…
                  </div>
                </SidebarMenuItem>
              ) : sessions.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    Ingen samtaler enda
                  </div>
                </SidebarMenuItem>
              ) : (
                sessions.map((s) => {
                  const href = `/agent/${s.id}`;
                  const isActive = pathname === href;
                  const label = s.title ?? "Uten tittel";
                  return (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton
                        render={<Link href={href} />}
                        isActive={isActive}
                        tooltip={label}
                      >
                        <MessageSquareIcon />
                        <span className="truncate">{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
          <UserButton />
          {!isCollapsed && (
            <OrganizationSwitcher
              hidePersonal
              afterSelectOrganizationUrl="/agent"
              afterCreateOrganizationUrl="/pending"
              appearance={{
                elements: {
                  rootBox: "flex-1 min-w-0",
                  organizationSwitcherTrigger: "w-full min-w-0",
                  organizationPreview: "min-w-0",
                  organizationPreviewTextContainer: "min-w-0",
                  organizationPreviewMainIdentifier: "truncate",
                },
              }}
            />
          )}
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
