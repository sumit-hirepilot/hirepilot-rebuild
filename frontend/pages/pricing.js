import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Pricing.module.css';

/*
 * A7.25 — the FAQ asks "Is there a cost?" and had nowhere to send anyone.
 *
 * Two decisions are load-bearing here and both are stated on the page, not
 * just in this comment:
 *
 * 1. There IS a monthly application allowance, and the page says so.
 *
 *    It used to say the opposite - "Applications are not metered on any plan",
 *    in four places - while routes/plans.js metered exactly that (600/1500/4500
 *    a month), services/submissionGate.js REFUSED to submit at `remaining <= 0`,
 *    and the header pill counted it down on every authenticated page. The
 *    pricing page denied a limit the product enforces.
 *
 *    The allowance stays: it is the backstop on runaway Auto Apply, and
 *    weakening a safety control to make a sentence true is the wrong direction.
 *    The sentence changed instead. What is genuinely true, and kept, is that a
 *    credit is spent only on a submission an employer CONFIRMS - never on an
 *    attempt that stalled or was retried.
 *
 *    Found in the feature audit by reading the header pill against this page.
 *
 * 2. Match scoring and its four-weight breakdown are free at every tier,
 *    forever. The whole argument of this product is that the score is visible
 *    and explainable; putting the explanation behind a plan would make the
 *    free tier exactly the black box the landing page criticises.
 *
 * INR is the primary currency and USD is the toggle, because the people this
 * is built for are in India. That is a product decision, not a formatting one.
 */

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    inr: 0,
    usd: 0,
    tagline: 'Every job we have, scored.',
    features: [
      'Every job we have, from every source',
      'Match scoring with the full four-weight breakdown',
      '600 applications a month',
      'Application tracker and status history',
      'Resume tailoring, currently uncapped',
    ],
  },
  {
    id: 'pilot',
    name: 'Pilot',
    inr: 399,
    usd: 5,
    tagline: 'Tailoring that keeps up with you.',
    highlight: true,
    features: [
      'Everything in Free',
      '1,500 applications a month',
      'Cover letter generation',
      'Screening-answer pre-fill from your profile',
      'Saved searches that run on their own',
    ],
  },
  {
    id: 'copilot',
    name: 'Copilot',
    inr: 899,
    usd: 11,
    tagline: 'Research and outreach as well.',
    features: [
      'Everything in Pilot',
      '4,500 applications a month',
      'Auto Apply — hands off, daily capped',
      'Recruiter and referral lookup per role',
      'ATS check against the exact posting',
      'New sources added for you first',
    ],
  },
];

export default function Pricing() {
  const [currency, setCurrency] = useState('INR');
  const [stub, setStub] = useState(null);

  const price = (p) => (currency === 'INR' ? `₹${p.inr}` : `$${p.usd}`);

  return (
    <>
      <Head>
        <title>Pricing — HirePilot</title>
        <meta
          name="description"
          content="Match scoring and its breakdown are free at every tier. Paid plans add depth per job — tailoring, cover letters, outreach research — and a larger monthly application allowance."
        />
      </Head>
      <Layout>
        <section className={styles.head}>
          <div className="container">
            <h1>Pricing</h1>
            <p className={styles.sub}>
              Scoring is free, forever, including the breakdown that explains it. Paid plans buy
              depth of work per job, and a larger monthly allowance.{' '}
              <strong>Every plan has a monthly application allowance</strong>, shown below and
              counted in the header — one is used when an employer confirms a submission.
            </p>

            <div className={styles.toggle} role="group" aria-label="Currency">
              {['INR', 'USD'].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  className={currency === c ? styles.toggleOn : styles.toggleOff}
                  onClick={() => setCurrency(c)}
                >
                  {c === 'INR' ? '₹ INR' : '$ USD'}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.plansSection}>
          <div className="container">
            <div className={styles.plans}>
              {PLANS.map((p) => (
                <div key={p.id} className={p.highlight ? styles.planHighlight : styles.plan}>
                  <h2 className={styles.planName}>{p.name}</h2>
                  <p className={styles.planTag}>{p.tagline}</p>
                  <p className={styles.price}>
                    <span className={styles.amount}>{price(p)}</span>
                    <span className={styles.per}>{p.inr === 0 ? 'always' : '/ month'}</span>
                  </p>
                  <ul className={styles.features}>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {p.inr === 0 ? (
                    <Link href="/signup" className="btn-primary">
                      Start Free
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setStub(p.name)}
                    >
                      Choose {p.name}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/*
              * A7.25 — the checkout stub.
              *
              * Payments are not connected. This says so in the plainest words
              * available and never renders a receipt, an order number or a
              * thank-you: a confirmation for a payment that did not happen is
              * a fabricated record, which is the same class of defect as a
              * tracker row claiming an application nobody sent.
              */}
            {stub && (
              <div className={styles.stub} role="status">
                <p className={styles.stubTitle}>Checkout is not live yet.</p>
                <p>
                  Nothing has been charged and no payment details were collected. The {stub} plan
                  is priced and specified, but the payment gateway is not connected — when it is,
                  this button will take you to a real checkout.
                </p>
                <p>
                  Until then everything in <strong>Free</strong> is genuinely free, including match
                  scoring and its breakdown.
                </p>
                <button type="button" className={styles.stubClose} onClick={() => setStub(null)}>
                  Close
                </button>
              </div>
            )}
          </div>
        </section>

        <section className={styles.notes}>
          <div className="container">
            <h2>What you are actually paying for</h2>
            <dl className={styles.dl}>
              <dt>Scoring is free at every tier</dt>
              <dd>
                Every job carries a match score and every score opens into its four weights —
                skills, experience, location, salary. Charging for the explanation would make the
                free tier the black box this product exists to argue against.
              </dd>

              <dt>Counted on confirmation, never on an attempt</dt>
              <dd>
                Each plan has a monthly application allowance, and one is used only when an
                employer confirms a submission — never for an attempt that stalled on a CAPTCHA,
                a login, or a retry after a bad fill. The number left is in the header on every
                page, so it is never a surprise.
              </dd>

              <dt>Cancel in one click</dt>
              <dd>
                Settings → Plans → &ldquo;Cancel my plan&rdquo;. One click, no email, no retention
                call, no form asking why. Billing is not connected yet, so nothing has been
                charged and cancelling takes effect immediately — it puts you back on Free. Your
                data stays until you delete it.
              </dd>

              <dt>Prices in your currency</dt>
              <dd>
                INR is the primary price. The USD figure is the same plan converted for
                convenience; the amount actually billed is the one shown in the currency your
                payment method uses.
              </dd>
            </dl>
          </div>
        </section>
      </Layout>
    </>
  );
}
