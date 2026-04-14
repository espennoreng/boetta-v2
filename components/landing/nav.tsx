import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-sans text-xl font-semibold tracking-tight"
        >
          Boetta
        </Link>

        <div className="flex items-center gap-2">
          <Show when="signed-out">
            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/sign-in" />}
              nativeButton={false}
            >
              Logg inn
            </Button>
            <Button
              size="sm"
              render={<Link href="/sign-up" />}
              nativeButton={false}
            >
              Kom i gang
            </Button>
          </Show>
          <Show when="signed-in">
            <Button
              size="sm"
              render={<Link href="/agent" />}
              nativeButton={false}
            >
              Gå til Boetta
            </Button>
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
