import Head from 'next/head'

// Privacy policy (6.8.3). Linked from the Privacy box. Describes the state from 6.8.4 on:
// fonts served from this site, Vimeo player with "do not track". Keep it in sync with
// lib/analytics.js (what is collected) and components/DataProtection.js (the choice).
const UPDATED = 'November 2026'

export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy · Artur Kalinowski</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="legal-page">
        <a href="/" className="legal-back mini-text">← back</a>
        <h1 className="legal-title">Privacy</h1>
        <p className="legal-updated">Last updated: {UPDATED}</p>

        <section>
          <h2>Who is responsible</h2>
          <p>
            Artur Kalinowski, contact: <a href="mailto:artur.motion@gmail.com">artur.motion@gmail.com</a>.
            Write to this address for any question about your data or to use your rights (see below).
          </p>
        </section>

        <section>
          <h2>Hosting</h2>
          <p>
            This website is hosted by Vercel Inc. (USA). When you open it, Vercel&apos;s servers
            process technical data that every website needs to be delivered: your IP address, the
            time, the page requested, and your browser and operating system. This is necessary to
            show the site and keep it secure (Art. 6(1)(f) GDPR). Transfers to the USA are covered by
            Vercel&apos;s data processing agreement with the EU Standard Contractual Clauses.
          </p>
        </section>

        <section>
          <h2>Statistics (PostHog)</h2>
          <p>
            To understand how this portfolio is used, the site sends anonymous statistics to PostHog,
            on PostHog&apos;s EU servers (Frankfurt, Germany).
          </p>
          <p>
            <strong>Without your consent</strong> no cookies are set and nothing is stored on your
            device; every visit is counted as a new one. Collected: the pages you view and how long,
            clicks, how far you scroll, whether and how long the showreel is watched, device type,
            browser, screen size, how well the 3D background runs on your device, and your approximate
            location (country, region, city), which PostHog derives from your IP address. Legal basis:
            legitimate interest in improving the website (Art. 6(1)(f) GDPR).
          </p>
          <p>
            <strong>If you click &quot;Accept&quot;</strong> in the Privacy box, PostHog additionally
            records heatmaps and session replays (mouse movement, clicks and scrolling on this page;
            the 3D animation and any typed text are not recorded) and stores an identifier in your
            browser&apos;s local storage, so a return visit is recognised. No cookies are used. Legal
            basis: your consent (Art. 6(1)(a) GDPR, § 25(1) TDDDG). You can withdraw it at any time in
            the Privacy box (top right): &quot;Decline&quot; stops the recording at once and deletes
            the stored identifier.
          </p>
          <p>
            The data is used only for these statistics, is not sold or used for advertising, and is
            deleted when it is no longer needed for them.
          </p>
        </section>

        <section>
          <h2>Showreel (Vimeo)</h2>
          <p>
            The showreel is played by Vimeo (Vimeo.com, Inc., USA). Vimeo is contacted only when you
            open the showreel; Vimeo then receives your IP address and technical data about your
            device. The player is set to &quot;do not track&quot;, so Vimeo does not use cookies to
            follow your activity. Legal basis: you asked to watch the video (Art. 6(1)(b) and (f)
            GDPR). More in Vimeo&apos;s privacy policy.
          </p>
        </section>

        <section>
          <h2>Fonts</h2>
          <p>The fonts are served from this website. No connection to Google or other font services is made.</p>
        </section>

        <section>
          <h2>Links</h2>
          <p>
            The LinkedIn link is a plain link: no data goes to LinkedIn unless you click it. After that,
            LinkedIn&apos;s privacy policy applies.
          </p>
        </section>

        <section>
          <h2>Stored on your device</h2>
          <p>
            Your choice in the Privacy box and when you made it (local storage, so you are not asked
            again), and, only after &quot;Accept&quot;, PostHog&apos;s identifier. You can delete
            them at any time in your browser settings.
          </p>
        </section>

        <section>
          <h2>Your rights</h2>
          <p>
            You have the right to access your data, to have it corrected or deleted, to restrict its
            processing, to data portability, and to object to processing based on legitimate interest
            (Art. 15–21 GDPR). You can withdraw consent at any time, with effect for the future. You
            can also complain to a data protection supervisory authority.
          </p>
        </section>
      </main>
    </>
  )
}
