import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="flex flex-1 border-b bg-gradient-to-b from-muted/40 to-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-20 md:py-28">
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          Byggesaksvurdering som står seg juridisk
        </h1>
        <p className="text-lg text-muted-foreground md:text-xl">
          Boetta vurderer byggesøknader mot DIBKs sjekklister og gir deg
          begrunnede svar med henvisninger til PBL og SAK10.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            render={<Link href="/sign-up" />}
            nativeButton={false}
          >
            Kom i gang
          </Button>
        </div>
      </div>
    </section>
  );
}
