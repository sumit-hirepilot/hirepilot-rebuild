import Head from 'next/head';
import Link from 'next/link';
import Layout from '../components/Layout';
import styles from '../styles/Legal.module.css';

/*
 * A7.25 — How to cancel a HirePilot plan, what happens to your data, and when a refund applies.
 *
 * Written to describe what this product actually does. Where a thing is not
 * built yet, it says so rather than reserving a right nobody is exercising.
 */
export default function RefundPolicy() {
  return (
    <>
      <Head>
        <title>Refunds and cancellation — HirePilot</title>
        <meta name="description" content="How to cancel a HirePilot plan, what happens to your data, and when a refund applies." />
      </Head>
      <Layout>
        <section className={styles.wrap}>
          <div className="container">
            <h1>Refunds and cancellation</h1>
            <p className={styles.updated}>Last updated 6 August 2026</p>
            <div className={styles.body}>
              <h2>Cancelling</h2>
              <p>
                Settings → Plans → &ldquo;Cancel my plan&rdquo;. One click. There is no email to
                send, no form asking why you are leaving, and no retention offer in the way.
                Billing is not connected yet, so nothing has been charged: cancelling takes effect
                immediately and puts you back on Free. Once billing is live this will change to
                the end of the period you have already paid for, and this page will say so before
                it does.
              </p>

              <h2>Refunds</h2>
              <ul>
                <li><strong>Within 7 days of a first payment</strong> — full refund, for any reason, including no reason.</li>
                <li><strong>A charge you did not intend</strong> — for example a renewal you meant to cancel, or a duplicate charge — refunded in full when you tell us.</li>
                <li><strong>A month where the product did not work</strong> — if a fault on our side stopped you using what you paid for, tell us what happened and we will refund that period.</li>
                <li><strong>Part-months</strong> — we do not pro-rate a cancellation mid-period, because you keep access for the rest of it.</li>
              </ul>

              <h2>How to ask</h2>
              <p>
                Write to us from the <Link href="/contact">contact page</Link> with the email on
                the account. We do not require a reason. Refunds are issued to the original payment
                method, and we will confirm when it has been sent.
              </p>

              <h2>What happens to your data</h2>
              <p>
                Cancelling a plan does not delete anything. Your account drops to the Free tier,
                which keeps the whole job index, match scoring and the full score breakdown, your
                tracker and your history. If you want the data gone as well, delete the account —
                that is a separate, deliberate action, also one click.
              </p>

              <h2>While payments are not enabled</h2>
              <p>
                No payment method is currently connected, so there is nothing to refund. This page
                describes what will apply when checkout goes live; it is published now so the terms
                are visible before anyone is asked to pay rather than after.
              </p>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
}
