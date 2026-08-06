import Head from 'next/head';
import Link from 'next/link';
import Layout from '../components/Layout';
import styles from '../styles/Legal.module.css';

/*
 * A7.25 — What HirePilot stores, why it stores it, and how to get it back or delete it.
 *
 * Written to describe what this product actually does. Where a thing is not
 * built yet, it says so rather than reserving a right nobody is exercising.
 */
export default function Privacy() {
  return (
    <>
      <Head>
        <title>Privacy policy — HirePilot</title>
        <meta name="description" content="What HirePilot stores, why it stores it, and how to get it back or delete it." />
      </Head>
      <Layout>
        <section className={styles.wrap}>
          <div className="container">
            <h1>Privacy policy</h1>
            <p className={styles.updated}>Last updated 6 August 2026</p>
            <div className={styles.body}>
              <h2>What this covers</h2>
              <p>
                HirePilot is a job search tool. To do its job it holds your account details, the
                resume you upload, the answers you save for application forms, and a record of the
                jobs you have tracked or applied to. This page describes each of those and what
                happens to them.
              </p>

              <h2>What we store</h2>
              <ul>
                <li><strong>Account</strong> — your email address and a hashed password. We never store your password in a readable form.</li>
                <li><strong>Resume</strong> — the file you upload and the text extracted from it. This is the material every match score and every tailored draft is built from.</li>
                <li><strong>Application profile</strong> — the answers you choose to save for screening questions, such as notice period or work authorisation. You decide what is saved; nothing is captured from a form without you saving it.</li>
                <li><strong>Applications and tracking</strong> — which jobs you queued, drafted, submitted or marked as applied, and the status history of each.</li>
                <li><strong>Job index</strong> — public job postings collected from the sources listed on the site. These are not personal to you.</li>
              </ul>

              <h2>What we do not do</h2>
              <ul>
                <li>We do not sell your data, and we do not share it with recruiters or employers except as part of an application you approved.</li>
                <li>We do not answer demographic or equal-opportunity questions on your behalf. Those are always left for you, on every plan, without exception.</li>
                <li>We do not invent content for your resume. Tailoring only rearranges and re-emphasises material already in your own document, and every change is shown to you before it is used.</li>
                <li>We do not submit an application without your approval.</li>
              </ul>

              <h2>Third parties</h2>
              <p>
                The application runs on Railway, which hosts the servers and the database. Job
                postings come from the public sources named on the site. If you use the Chrome
                extension, it runs in your own browser and talks only to HirePilot and to the job
                board you are applying on — it does not send your data anywhere else.
              </p>

              <h2>Retention and deletion</h2>
              <p>
                Your data stays until you delete it. Deleting your account removes your profile,
                resume, saved answers and application records. Aggregate counts that identify
                nobody — such as how many jobs the index holds — are not tied to your account and
                are unaffected.
              </p>

              <h2>Your rights</h2>
              <p>
                You can export or delete your data at any time from Settings, or by writing to us
                at the address on the <Link href="/contact">contact page</Link>. If you are in a
                jurisdiction with a statutory right of access or erasure, that is the same
                mechanism, and we will not ask you to justify the request.
              </p>

              <h2>Changes</h2>
              <p>
                If this policy changes in a way that affects what we store or who can see it, the
                change will be dated at the top of this page and announced in the product before it
                takes effect.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
}
