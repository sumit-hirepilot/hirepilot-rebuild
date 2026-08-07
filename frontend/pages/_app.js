import Head from 'next/head';
import '../styles/globals.css';

/*
 * The viewport declaration lives here because the claim is about the product,
 * not about one page.
 *
 * `<meta name="viewport">` was set in pages/index.js and nowhere else, while
 * the landing page says "HirePilot runs in your mobile browser - the whole
 * product, nothing to install." Every other page - the feed, the tracker,
 * settings, the apply queue - shipped without it, so a real phone laid them
 * out at the ~980px fallback width and zoomed out. The responsive CSS was
 * already correct and never got the chance to apply.
 *
 * This did not show up in the audit's 375px pass: resizing the browser sets a
 * true viewport width, so the media queries ran and the pages looked right.
 * Only a real mobile browser reads this tag. The instrument could not see the
 * defect it was pointed at.
 *
 * Found by the claim-test sweep - landingTruth asserted the page SAYS "mobile
 * browser" and never that anything supports it.
 *
 * In the pages router this belongs in _app, not _document: Next warns that a
 * viewport tag in _document can be duplicated or dropped.
 */
function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}

export default MyApp;
