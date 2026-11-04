import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html className="preloader-active">
      <Head>
        <meta name="theme-color" content="#000" />
        <link rel="icon" type="image/png" href="/assets/gold_favico.png" />
        {/* Fonts are served from this site (public/fonts, @font-face in globals.css): no request to
            Google. Preload the Latin files so the text shows in the right font straight away. */}
        <link rel="preload" href="/fonts/space-grotesk-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}