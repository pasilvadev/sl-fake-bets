import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * The privacy page (plan-hosted-early-access.md D8, Phase 1 task 8) — the
 * honest thing to have on a public URL that stores emails, password hashes,
 * Google profile basics and avatars (§2.2). Plain language, not a legal
 * document; the owner reads it before Phase 3 goes live.
 *
 * Server-rendered and indexable (no `robots` override — the default is the
 * same `allow: "/"` every route gets unless it opts out, and `robots.ts`
 * never disallows `/privacy`), listed in `sitemap.ts`. Unlike `/join/[code]`
 * and `/bet/[id]` this page carries no secret in its own URL, so there is
 * nothing here for a crawler to leak.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

const sectionHeadingClass =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const sectionBodyClass = "mt-1 text-sm leading-relaxed text-foreground";

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");

  return (
    <main className="mx-auto min-h-svh max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-text-strong">
        {t("title")}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t("intro")}
      </p>

      <div className="mt-8 space-y-6">
        <section>
          <h2 className={sectionHeadingClass}>{t("whatHeading")}</h2>
          <p className={sectionBodyClass}>{t("whatBody")}</p>
        </section>

        <section>
          <h2 className={sectionHeadingClass}>{t("emailHeading")}</h2>
          <p className={sectionBodyClass}>{t("emailBody")}</p>
        </section>

        <section>
          <h2 className={sectionHeadingClass}>{t("whereHeading")}</h2>
          <p className={sectionBodyClass}>{t("whereBody")}</p>
        </section>

        <section>
          <h2 className={sectionHeadingClass}>{t("coinsHeading")}</h2>
          <p className={sectionBodyClass}>{t("coinsBody")}</p>
        </section>

        <section>
          <h2 className={sectionHeadingClass}>{t("teamHeading")}</h2>
          <p className={sectionBodyClass}>{t("teamBody")}</p>
        </section>

        <section>
          <h2 className={sectionHeadingClass}>{t("deleteHeading")}</h2>
          <p className={sectionBodyClass}>{t("deleteBody")}</p>
        </section>
      </div>
    </main>
  );
}
