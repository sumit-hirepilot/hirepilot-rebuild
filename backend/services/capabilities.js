/*
 * L1 — ONE definition of what this deployment can actually do.
 *
 * A feature whose code is complete but whose credential is absent must not
 * present as working anywhere, and must light up the moment the operator
 * sets the variable - with no code change and no second flag to forget.
 * Every surface that mentions such a feature reads THIS, so two surfaces
 * cannot disagree about whether mail works (the settings page said
 * "recruiter mail works today" while the inbox page said it was not
 * connected - both were reading different truths).
 *
 * Only code-complete capabilities belong here. Payments is deliberately NOT
 * listed: its integration does not exist, so an env-driven flag would light
 * up a button with nothing behind it. /pricing carries a labelled stub
 * instead, which is the honest shape for an unbuilt feature.
 *
 * Booleans only - this payload is served without auth, and a capability
 * report that leaks the secret it is keyed on would be its own incident.
 */

function capabilities() {
  return {
    // The inbound-mail wire (routes/inbox.js /inbound) is code-complete and
    // provider-proven; it waits on INBOUND_MAIL_SECRET plus provider DNS.
    inboundMail: Boolean(process.env.INBOUND_MAIL_SECRET),
    // The controlled submission target, gated exactly as routes/apply.js
    // gates the whitelist entry.
    atsSandbox: process.env.ATS_SANDBOX_ENABLED === 'true',
  };
}

module.exports = { capabilities };
