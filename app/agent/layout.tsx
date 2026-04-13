import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3">
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/agent"
          afterCreateOrganizationUrl="/pending"
        />
        <UserButton />
      </div>
      {children}
    </>
  );
}
