import Head from 'next/head'
import { useEffect } from 'react'
import '../styles/globals.css'
import { initAnalytics } from '../lib/analytics'
import FpsMeter from '../components/FpsMeter'
import Preloader from '../components/Preloader'
import DataProtection from '../components/DataProtection'

export default function App({ Component, pageProps }) {
  // Statistics start after the page has loaded (own chunk; see lib/analytics.js)
  useEffect(() => {
    const start = () => initAnalytics()
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => window.removeEventListener('load', start)
  }, [])

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Artur Kalinowski</title>
      </Head>
      <Preloader />
      <Component {...pageProps} />
      <FpsMeter visible={true} />
      <DataProtection />
    </>
  )
}
