/**
 * Outbound URLs that appear in more than one place.
 *
 * The repository URL was already written out in `index.html` twice (the JSON-LD
 * `codeRepository` and `softwareHelp`) and in the README. Anything the legal page
 * links to has to agree with those — a dead link on a page about trademarks and
 * licensing is the one place a stale URL actually costs something.
 */
export const REPO_URL = 'https://github.com/morsela/walkingpad';

/** Where feedback goes. Named in the feedback sheet, in the privacy section of the
 *  legal page, and in the `mailto:` those two compose — three places that have to
 *  agree, since the second is a promise about the first. */
export const SUPPORT_EMAIL = 'support@beltcontrol.com';
