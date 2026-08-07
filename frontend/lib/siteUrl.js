/*
 * The site's own public origin, for the tags that have to state it absolutely.
 *
 * og:url and og:image cannot be relative - a crawler resolves them on its own
 * host, so they have to name the site. That makes them the one place where the
 * deployment's address is written into the page, and the one place that goes
 * stale when the app moves.
 *
 * They named a specific deployment as a literal, so after the move to a new
 * Railway account the new site advertised the OLD site's URL and pulled the OLD
 * site's og.png: every link shared from the new deployment pointed people back
 * at the previous one. Nothing on the page looks wrong, which is what makes it
 * the kind of thing that survives a migration.
 *
 * No fallback to a deployed host, for the same reason as lib/apiBase: guessing
 * another environment's address is worse than admitting we do not know. When
 * this is unset the social tags are simply omitted - a missing preview is
 * honest, a preview pointing at the wrong site is not.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || null;

export default SITE_URL;
