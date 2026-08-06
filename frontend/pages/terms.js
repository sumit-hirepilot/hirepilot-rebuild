import Head from 'next/head';
import Link from 'next/link';
import Layout from '../components/Layout';
import styles from '../styles/Legal.module.css';

/*
 * A7.25 — The agreement between you and HirePilot, including what the product promises and what it does not.
 *
 * Written to describe what this product actually does. Where a thing is not
 * built yet, it says so rather than reserving a right nobody is exercising.
 */
export default function Terms() {
  return (
    <>
      <Head>
        <title>Terms of service — HirePilot</title>
        <meta name="description" content="The agreement between you and HirePilot, including what the product promises and what it does not." />
      </Head>
      <Layout>
        <section className={styles.wrap}>
          <div className="container">
            <h1>Terms of service</h1>
            <p className={styles.updated}>Last updated 6 August 2026</p>
            <div className={styles.body}>
              <h2>The agreement</h2>
              <p>
                By creating a HirePilot account you agree to these terms. They are deliberately
                short, and they try to describe the product as it actually behaves rather than
                reserving rights we do not use.
              </p>

              <h2>What the service does</h2>
              <p>
                HirePilot indexes publicly posted jobs, scores them against the resume you upload,
                helps you tailor that resume, and tracks what you have applied to. Where an
                application can be submitted through the browser extension, it is prepared as a
                draft and held for your approval. HirePilot does not apply on your behalf without
                that approval.
              </p>

              <h2>What it does not promise</h2>
              <ul>
                <li>We do not promise a job, an interview, or a reply. No tool can.</li>
                <li>Match scores are a ranking aid computed from your resume and the posting text. They are not a judgement of you, and they are not an employer&apos;s opinion.</li>
                <li>Job postings come from third-party sources. A posting may be filled, withdrawn or stale by the time you see it; where we can tell, we say so.</li>
              </ul>

              <h2>Your responsibilities</h2>
              <ul>
                <li>Everything you submit through HirePilot is your application, in your name. Review what is being sent — the review screen exists so that you can.</li>
                <li>Keep your resume and saved answers accurate. The product never invents content, which means it also cannot correct a mistake you have saved.</li>
                <li>Do not use the service to submit applications you do not intend to honour, or to misrepresent your experience.</li>
              </ul>

              <h2>Acceptable use</h2>
              <p>
                Do not attempt to circumvent the rate limits or approval gates, resell access, or
                use the service to scrape data for another product. Some job boards restrict
                automated access; where that is the case we do not fetch them, and we ask you not
                to work around it either.
              </p>

              <h2>Payment</h2>
              <p>
                Paid plans are described on the <Link href="/pricing">pricing page</Link>. Payments
                are not yet enabled; when they are, billing is monthly, cancellation takes effect at
                the end of the paid period, and the terms on the
                <Link href="/refund-policy"> refunds page</Link> apply.
              </p>

              <h2>Ending the agreement</h2>
              <p>
                You can close your account at any time from Settings. We may suspend an account
                that is being used to abuse the service or a job board, and we will tell you why.
              </p>

              <h2>Liability</h2>
              <p>
                The service is provided as it is. We are not liable for an application that fails to
                send, a posting that turns out to be stale, or a hiring decision made by anyone
                else. Where liability cannot be excluded by law, it is limited to the amount you
                have paid us in the previous twelve months.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
}
