import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PlaceholderBanner() {
  return (
    <Alert className="mb-10 border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <AlertTriangle />
      <AlertTitle>Innholdet må erstattes før lansering</AlertTitle>
      <AlertDescription>
        Denne siden er en plassholder generert sammen med landingssiden.
        Erstatt teksten under med endelig juridisk innhold før produksjon.
      </AlertDescription>
    </Alert>
  );
}
