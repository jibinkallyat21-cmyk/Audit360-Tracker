import { DocSyncSetup } from "@/components/doc-sync";
import { PageHero } from "@/components/ui";

export default function SyncPage() {
  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Save files to my computer" />
      <section className="panel stack">
        <p>
          Choose a folder on this computer once. From then on, every file the teams upload is saved
          there automatically, in folders by process, step and line (for example{" "}
          <span className="mono">3.5 Substantive Procedures / Step 1 / EOSB / file.xlsx</span>). A
          new version of a file is saved next to the old one as <em>name (v2)</em>, nothing is
          overwritten, and a file is never downloaded twice.
        </p>
        <DocSyncSetup />
        <p className="muted">
          It works while the site is open in Edge or Chrome on this computer (any page, any tab); it
          checks every minute. If you close the browser, it catches up the next time you open the
          site. After a restart the browser may ask you to confirm access to the folder: a button
          appears at the top of the page for that. This is set up only in your own browser; other
          people do not get it. Each saved file is recorded as a download in the activity history.
        </p>
      </section>
    </main>
  );
}
