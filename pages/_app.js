import Head from 'next/head'
import '../styles/globals.css'
import FpsMeter from '../components/FpsMeter'
import Preloader from '../components/Preloader'
import DataProtection from '../components/DataProtection'

export default function App({ Component, pageProps }) {
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
