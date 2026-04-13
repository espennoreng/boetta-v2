"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Show, UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ANCHORS = [
  { href: "/#hvorfor", label: "Hvorfor" },
  { href: "/#slik-fungerer-det", label: "Slik fungerer det" },
  { href: "/#sikkerhet", label: "Sikkerhet" },
  { href: "/#kontakt", label: "Kontakt" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-sans text-xl font-semibold tracking-tight"
        >
          Boetta
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {ANCHORS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {a.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
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
              render={
                <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
              }
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

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div
        className={cn(
          "border-t md:hidden",
          open ? "block" : "hidden",
        )}
      >
        <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
          {ANCHORS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {a.label}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t pt-4">
            <Show when="signed-out">
              <Button
                variant="ghost"
                size="sm"
                className="justify-start"
                render={<Link href="/sign-in" />}
                nativeButton={false}
              >
                Logg inn
              </Button>
              <Button
                size="sm"
                render={
                  <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
                }
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
              <div className="flex justify-start px-3 py-2">
                <UserButton />
              </div>
            </Show>
          </div>
        </nav>
      </div>
    </header>
  );
}
