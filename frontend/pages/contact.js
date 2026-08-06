import Head from 'next/head';
import Link from 'next/link';
import Layout from '../components/Layout';
import styles from '../styles/Legal.module.css';

/*
 * A7.25 — How to reach HirePilot about your account, a bug, a data request, or a job source.
 *
 * Written to describe what this product actually does. Where a thing is not
 * built yet, it says so rather than reserving a right nobody is exercising.
 */
export default function Contact() {
  return (
    <>
      <Head>
        <title>Contact — HirePilot</title>
        <meta name="description" content="How to reach HirePilot about your account, a bug, a data request, or a job source." />
      </Head>
      <Layout>
        <section className={styles.wrap}>
          <div className="container">
            <h1>Contact</h1>
            <p className={styles.updated}>Last updated 6 August 2026</p>
            <div className={styles.body}>
              <h2>Email</h2>
              <p>
                <a href="mailto:sumituxui@gmail.com">sumituxui@gmail.com</a> reaches a person. It is
                the fastest route for anything about your account, and the correct route for a data
                export or deletion request.
              </p>

              <h2>What to include</h2>
              <ul>
                <li><strong>Account questions</strong> — write from the email address on the account, so we can be sure it is you without asking for anything else.</li>
                <li><strong>A bug</strong> — the page you were on, what you expected, and what happened instead. A screenshot helps more than a description of the screenshot.</li>
                <li><strong>A wrong job</strong> — the link to the posting as HirePilot showed it. Mis-parsed postings are a defect we fix at the source, not one at a time.</li>
                <li><strong>Data export or deletion</strong> — say which, and it will be done. You do not have to give a reason.</li>
              </ul>

              <h2>Suggesting a job source</h2>
              <p>
                If a board you rely on is missing, send the link. Before anything is added we check
                that it publishes real employer postings rather than freelance listings, that it
                gives a genuine publication date per posting, and that its own machine-readable
                rules permit automated access. Boards that restrict automated access are not
                indexed, and a page loading successfully is not treated as permission.
              </p>

              <h2>Response times</h2>
              <p>
                This is a small operation, so replies come in days rather than minutes. Data
                requests are handled first. If you have not heard back within a week, send the same
                email again — it will not have been ignored on purpose.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
}
