import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center">
        <p>© 2026 Boetta</p>
        <nav className="flex gap-6">
          <Link href="/personvern" className="hover:text-foreground">
            Personvern
          </Link>
          <Link href="/vilkar" className="hover:text-foreground">
            Vilkår
          </Link>
          <Link href="/kontakt" className="hover:text-foreground">
            Kontakt
          </Link>
        </nav>
      </div>
    </footer>
  );
}
