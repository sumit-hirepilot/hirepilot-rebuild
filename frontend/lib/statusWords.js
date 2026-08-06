/*
 * Wave C — status words a person understands.
 *
 * The stored statuses are the system's vocabulary: approved, submitting,
 * submitted, needs_user, pending_review. A person waiting to hear back from an
 * employer does not think in those terms, and "submitted" in particular tells
 * them nothing about what happens next.
 *
 * Every line answers "what is happening, and is it on me?" - because that is
 * the only question a person actually has about an application.
 *
 * The stored value never changes. This is a reading of it, in one place, so
 * the tracker and the pipeline cannot describe the same row differently.
 */

export const STATUS_WORDS = {
  pending_review: { label: 'Waiting for you to check', hint: 'Nothing is sent until you look at it.' },
  needs_user: { label: 'Needs an answer from you', hint: 'A question on the form only you can answer.' },
  approved: { label: 'Ready to send', hint: 'Approved and waiting its turn.' },
  submitting: { label: 'Sending now', hint: 'Filling the form on the employer’s site.' },
  submitted: { label: 'Waiting for the company', hint: 'Sent. Employers rarely reply straight away.' },
  applied: { label: 'Waiting for the company', hint: 'Sent, and the employer confirmed it.' },
  phone_screen: { label: 'They replied — first call', hint: null },
  technical_interview: { label: 'They replied — interview', hint: null },
  onsite: { label: 'They replied — final round', hint: null },
  offer: { label: 'Offer', hint: null },
  hired: { label: 'Hired', hint: null },
  rejected: { label: 'No this time', hint: 'Not a reflection of the work you did.' },
  failed: { label: 'Did not send', hint: 'Nothing reached the employer — you can try again.' },
  skipped: { label: 'You skipped this', hint: null },
};

/**
 * The human reading of a stored status.
 *
 * Falls back to a humanised key rather than the key itself: a status we have
 * not written a line for should still not appear as `phone_screen`.
 */
export function statusWord(status) {
  const known = STATUS_WORDS[status];
  if (known) return known.label;
  if (!status) return '';
  return String(status).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function statusHint(status) {
  return STATUS_WORDS[status]?.hint || null;
}
