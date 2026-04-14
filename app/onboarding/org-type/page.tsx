import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Landmark, Hammer, CheckIcon } from "lucide-react";
import { submitOrgType } from "./actions";
import { Button } from "@/components/ui/button";

type Option = {
  value: "municipality" | "tiltakshaver";
  title: string;
  subtitle: string;
  description: string;
  Icon: typeof Landmark;
};

const options: Option[] = [
  {
    value: "municipality",
    title: "Kommune",
    subtitle: "Saksbehandler",
    description:
      "Du gjennomgår innkomne byggesøknader og skal vurdere dem mot PBL og SAK10.",
    Icon: Landmark,
  },
  {
    value: "tiltakshaver",
    title: "Tiltakshaver",
    subtitle: "Ansvarlig søker",
    description:
      "Du forbereder og sender inn byggesøknader, og vil ha dem godkjent første gang.",
    Icon: Hammer,
  },
];

export default async function OrgTypePage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: orgId,
  });
  const existing = org.publicMetadata?.orgType;
  if (existing === "municipality" || existing === "tiltakshaver") {
    redirect("/agent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <form
        action={submitOrgType}
        className="w-full max-w-2xl flex flex-col gap-8"
      >
        <div className="text-center space-y-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Hva slags organisasjon er dere?
          </h1>
          <p className="text-muted-foreground">
            Velg rollen som passer best. Det avgjør hvilke agenter du får
            tilgang til.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {options.map(({ value, title, subtitle, description, Icon }) => (
            <label
              key={value}
              className="group relative flex h-full cursor-pointer flex-col items-center gap-4 rounded-4xl bg-card p-8 text-center shadow-md ring-1 ring-foreground/5 transition-all hover:ring-foreground/25 has-[:checked]:ring-2 has-[:checked]:ring-primary has-[:checked]:shadow-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name="orgType"
                value={value}
                className="sr-only"
                required
              />
              <span className="absolute right-5 top-5 flex size-6 items-center justify-center rounded-full border-2 border-muted-foreground/25 bg-background text-primary-foreground transition-colors group-has-[:checked]:border-primary group-has-[:checked]:bg-primary">
                <CheckIcon className="size-3.5 opacity-0 transition-opacity group-has-[:checked]:opacity-100" />
              </span>
              <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/15 group-has-[:checked]:bg-primary/20">
                <Icon className="size-7" />
              </span>
              <div className="space-y-1">
                <div className="font-heading text-lg font-medium">{title}</div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {subtitle}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </label>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button type="submit" size="lg" className="w-full max-w-xs">
            Fortsett
          </Button>
          <p className="text-xs text-muted-foreground">
            Du får 14 dagers gratis prøveperiode.
          </p>
        </div>
      </form>
    </div>
  );
}
