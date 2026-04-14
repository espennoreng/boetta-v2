"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import {
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessions, type SessionListItem } from "./sessions-provider";
import type { SidebarAgentInfo } from "../layout";

interface AgentSidebarProps {
  sidebarAgents: SidebarAgentInfo[];
}

export function AgentSidebar({ sidebarAgents }: AgentSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { sessions, loading, renameSession } = useSessions();
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;
  const [editingId, setEditingId] = useState<string | null>(null);

  // Extract active agent slug from pathname: /agent/<slug>/... or /agent/<slug>
  const activeAgent = pathname.match(/^\/agent\/([^/]+)/)?.[1] ?? null;

  // Single-agent case: use the simple layout
  if (sidebarAgents.length === 1) {
    const agent = sidebarAgents[0];
    const isActiveAgent = activeAgent === agent.slug;

    return (
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => router.push(`/agent/${agent.slug}`)}
                tooltip={agent.newSessionLabel}
              >
                <PlusIcon />
                <span>{agent.newSessionLabel}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{agent.sessionGroupLabel}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {loading && sessions.length === 0 ? (
                  <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
                    <div className="px-3 py-1 text-muted-foreground text-xs">
                      Laster…
                    </div>
                  </SidebarMenuItem>
                ) : sessions.length === 0 ? (
                  <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
                    <div className="px-3 py-1 text-muted-foreground text-xs">
                      Ingen {agent.sessionGroupLabel.toLowerCase()} enda
                    </div>
                  </SidebarMenuItem>
                ) : (
                  sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      agentSlug={agent.slug}
                      isActive={isActiveAgent && pathname === `/agent/${agent.slug}/${s.id}`}
                      isEditing={editingId === s.id}
                      onStartEdit={() => setEditingId(s.id)}
                      onEndEdit={() => setEditingId(null)}
                      onRename={renameSession}
                    />
                  ))
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

  // Multi-agent case: group by agent, with buttons for each
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          {sidebarAgents.map((agent) => {
            const isActiveAgent = activeAgent === agent.slug;
            return (
              <SidebarMenuItem key={agent.slug}>
                <SidebarMenuButton
                  onClick={() => router.push(`/agent/${agent.slug}`)}
                  tooltip={agent.newSessionLabel}
                  variant={isActiveAgent ? "default" : "outline"}
                >
                  <PlusIcon />
                  <span>{agent.newSessionLabel}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sidebarAgents.map((agent) => {
          const isActiveAgent = activeAgent === agent.slug;
          const agentSessions = sessions.filter(
            (s) => s.agentType === agent.slug
          );

          return (
            <SidebarGroup key={agent.slug}>
              <SidebarGroupLabel
                className={
                  isActiveAgent ? "text-foreground" : "text-muted-foreground"
                }
              >
                {agent.sessionGroupLabel}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {loading && sessions.length === 0 ? (
                    <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
                      <div className="px-3 py-1 text-muted-foreground text-xs">
                        Laster…
                      </div>
                    </SidebarMenuItem>
                  ) : agentSessions.length === 0 ? (
                    <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
                      <div className="px-3 py-1 text-muted-foreground text-xs">
                        Ingen {agent.sessionGroupLabel.toLowerCase()} enda
                      </div>
                    </SidebarMenuItem>
                  ) : (
                    agentSessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        agentSlug={agent.slug}
                        isActive={isActiveAgent && pathname === `/agent/${agent.slug}/${s.id}`}
                        isEditing={editingId === s.id}
                        onStartEdit={() => setEditingId(s.id)}
                        onEndEdit={() => setEditingId(null)}
                        onRename={renameSession}
                      />
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
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

interface SessionRowProps {
  session: SessionListItem;
  agentSlug: string;
  isActive: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
}

function SessionRow({
  session,
  agentSlug,
  isActive,
  isEditing,
  onStartEdit,
  onEndEdit,
  onRename,
}: SessionRowProps) {
  const label = session.title ?? "Uten tittel";
  const href = `/agent/${agentSlug}/${session.id}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(session.title ?? "");

  useEffect(() => {
    if (isEditing) {
      setDraft(session.title ?? "");
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing, session.title]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === session.title) {
      onEndEdit();
      return;
    }
    try {
      await onRename(session.id, trimmed);
    } catch {
      // renameSession rolls back optimistic update; silently exit edit mode.
    }
    onEndEdit();
  }, [draft, onEndEdit, onRename, session.id, session.title]);

  if (isEditing) {
    return (
      <SidebarMenuItem>
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onEndEdit();
              }
            }}
            maxLength={120}
            className="w-full min-w-0 bg-transparent text-sm outline-none"
          />
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={isActive}
        tooltip={label}
      >
        <MessageSquareIcon />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <SidebarMenuAction
          showOnHover
          render={
            <DropdownMenuTrigger>
              <MoreHorizontalIcon />
              <span className="sr-only">Handlinger</span>
            </DropdownMenuTrigger>
          }
        />
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onClick={onStartEdit}>
            <PencilIcon />
            Endre navn
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
