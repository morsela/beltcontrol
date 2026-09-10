/**
 * Outbound URLs that appear in more than one place.
 *
 * The repository URL is also written out in `index.html` three times (the JSON-LD
 * `codeRepository` and `softwareHelp`, and the link in the static intro) and in the
 * README. Anything the legal page links to has to agree with those — a dead link on a
 * page about trademarks and licensing is the one place a stale URL actually costs
 * something.
 *
 * It went stale anyway. Every one of those four pointed at `morsela/walkingpad` — the
 * working title, never a repository that existed — so the structured data cited a URL
 * that 404s and the in-app Source link, which is the whole path from a user who likes
 * this to a user who stars it, went nowhere. Grep for the old slug before trusting that
 * a rename is finished.
 */
export const REPO_URL = 'https://github.com/morsela/beltcontrol';

/** Where feedback goes. Named in the feedback sheet, in the privacy section of the
 *  legal page, and in the `mailto:` those two compose — three places that have to
 *  agree, since the second is a promise about the first. */
export const SUPPORT_EMAIL = 'support@beltcontrol.com';
