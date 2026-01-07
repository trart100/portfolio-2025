import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html className="preloader-active">
      <Head>
        <meta name="theme-color" content="#000" />
        <link rel="icon" type="image/png" href="/assets/gold_favico.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..700&family=Space+Grotesk:wght@300..600&display=swap" rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}