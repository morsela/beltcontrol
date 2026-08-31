# Deploying

```sh
npm run build           # tsc --noEmit && vite build  → dist/
npx vercel --prod
```

The output is static files. Any host will do; Vercel is what this repo is configured for, and
the GitHub repository is connected to the project, so a push to `main` deploys on its own.

Vercel serves HTTPS, which is the second context Web Bluetooth accepts (the first being
`http://localhost`). Hosting it is genuinely useful for **Chrome on Android**: open the URL on
a phone or tablet propped on the treadmill and install it to the home screen from the
manifest.

## What `vercel.json` says, and why

JSON has nowhere to put a comment, and Vercel's schema rejects unknown keys — an earlier
version of this file carried `comment` fields and could not deploy at all. So the reasoning
lives here instead.

| Rule | Reason |
|---|---|
| `/assets/*` → `max-age=31536000, immutable` | Vite fingerprints those filenames, so the same name always means the same bytes. |
| `index.html`, `sw.js`, `manifest.json` → `max-age=0, must-revalidate` | The shell, the worker and the manifest must never go stale, or a released fix sits behind a cached shell. |
| `sitemap.xml`'s `lastmod` is stamped at build time | With the last commit date, by the `stamp-sitemap` plugin in `vite.config.ts`. A hand-written date is wrong from the next commit onwards, and a `lastmod` a crawler finds stale teaches it to ignore the field on this host. |
| `sw.js` cache name is stamped at build time | `VERSION` in `sw.js` carries a hash of the emitted asset filenames, injected by the `stamp-service-worker` plugin in `vite.config.ts`. It was a hand-written constant that never moved, which left the worker's `activate` handler — delete every cache that is not `VERSION` — with nothing to delete on any deploy. |
| `Content-Security-Policy` | The one header that is load bearing rather than ordinary hardening — see below. |
| `X-Frame-Options: DENY` | Same intent as `frame-ancestors 'none'`, for browsers that predate it. |
| `Permissions-Policy: bluetooth=(self)` | Keeps the radio available to this origin and nothing it embeds. |
| `Strict-Transport-Security` | Web Bluetooth needs a secure context; this makes downgrade to plain HTTP a non-option. `.com` is not HSTS-preloaded by the registry, so this header is the only thing enforcing it. |
| `X-Content-Type-Options`, `Referrer-Policy` | Ordinary hardening. Nothing here is sensitive, but nothing here needs a referrer either. |
| the written pages and `content.css` → `max-age=0, must-revalidate` | Same reasoning as the shell. None of them is fingerprinted, so a cached copy is a correction that never lands. |
| `robots.txt`, `sitemap.xml` → `max-age=3600` | Crawlers re-read them often; an hour is short enough to fix a mistake and long enough to matter. |
| icons and `og.png` → `max-age=604800` | Unfingerprinted but near-immutable. A week means a redesign lands within a week rather than never. |
| `rewrites` → `/index.html` | Hash routing means the server only ever needs to serve the shell; the negative lookahead keeps real files (assets, icons, the manifest) being served as themselves — and now the written pages too, which are extensionless paths the old lookahead would have swallowed. |
| `trailingSlash: false` | The written pages are `dist/<slug>/index.html`, which Vercel serves at both `/slug` and `/slug/`. Two URLs for one page is a duplicate a canonical tag has to clean up after; this makes the server pick one and redirect the other. |

## The Content-Security-Policy

Most apps treat a CSP as defence in depth against data theft. Here the asset is a motor, so
the stakes are different: **`doStart` is behind a `confirm()`, but the speed controls are not.**
Script running on this origin can raise the belt to its maximum by clicking `+`, with no
dialog in the way. That makes script injection a physical-safety problem, not a data one, and
worth a policy tight enough to be boring:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self';
frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

Two entries earn their keep by being narrower than they look, and one is a concession:

- **`connect-src 'self'`** is what Vercel Web Analytics needs and all it needs — in a
  production build `@vercel/analytics` loads `/_vercel/insights/script.js` and beacons to
  `/_vercel/insights/*`, both same-origin. (It only reaches for `va.vercel-scripts.com` in
  dev, where these headers do not apply.) Nothing else in the app makes a request at all.
- **`worker-src 'self'`** is required for `sw.js`; without it the offline shell silently never
  registers.
- **`style-src 'unsafe-inline'`** is the concession. There are ~21 inline `style` attributes
  in the components, and every value interpolated into one is a number or a `var()` token
  from `tokens.css` — no string from the device, the log, or storage reaches a style. The
  narrower `style-src-attr` was rejected because a browser that does not implement it falls
  back to `style-src` and loses the styling entirely.

Verified against a production build served with these exact headers: the bundle, stylesheet,
manifest, icons and service worker all load, the blob-URL downloads behind Export CSV and
Export backup still work, and inline script, cross-origin script, styles, images, `fetch` and
frames are all refused.

The policy also decides what `index.html` may carry in its head, which the next section
leans on: the inline `<style>` behind the static intro and the `<noscript>` fallback is
covered by
`style-src 'unsafe-inline'`, and the `application/ld+json` block is a data block rather than
a script — the HTML parser never prepares it for execution, so `script-src 'self'` does not
reject it. Verified with the production headers in place: no violation is reported for
either.

## Search and link previews

`index.html` carries the canonical URL, Open Graph and Twitter card tags, and a
`SoftwareApplication` block of structured data. Three things there are deliberate:

- **The canonical is absolute and apex** (`https://beltcontrol.com/`). Every Vercel preview
  deployment is a public URL serving identical HTML, so without it the previews compete with
  production for the same query.
- **`og:image` is an absolute URL.** Slack, Discord and X do not resolve relative ones.
  The image is `public/og.png`, generated from `tools/og-image.html` — that file carries the
  headless-Chrome command to re-render it after a change to the mark or the tagline. Without
  it a shared link previews the app's own dark, empty shell.
- **The static intro in `<body>` is the page's only crawlable prose.** The app renders into
  an empty `<div>`, so without it the served document contains no text at all. `main.tsx`
  removes it the moment the app mounts — it is a first paint, and everything it claims is
  something the app then says properly.

  It exists because the `<noscript>` block cannot do this job, which this file previously
  claimed it did. Googlebot renders with JavaScript enabled, so it discards `<noscript>`
  exactly as a browser does; the block is worth keeping for the Firefox and Safari visitors
  who arrive anyway and deserve an explanation, but it has never been worth anything to
  search. Fetching the deployed page without a JavaScript engine returned nothing but the
  `<title>` — which is also what the crawlers behind the AI assistants see, and they are now
  a real way people find a tool like this.

## The written pages

Five ordinary HTML files live in `public/`, copied to `dist/` verbatim and served as
themselves:

| Path | What it answers |
|---|---|
| `/compatible-treadmills` | Will it work with my pad, and which numbers will it show |
| `/walkingpad-without-the-app` | What you give up by not installing KS+Fit, and what you don't |
| `/troubleshooting` | Why the chooser is empty, why a start is refused, why the link drops |
| `/walkingpad-on-iphone` | Why no iPhone can run this, and what is left |
| `/walkingpad-bluetooth-protocol` | The four BLE protocols, frame by frame |

They exist because a hash-routed app is one URL, and one URL cannot answer five different
questions to five different people arriving from five different searches. Every answer on
them was already written down — in the README, in `docs/protocols.md`, in the code
comments — just not anywhere a crawler could reach it.

Three things about how they are built:

- **They never load the app bundle.** A page that answers "will this work with my C2"
  should not ship a treadmill controller to render one table. They link to `/content.css`
  instead, which is a copy of `tokens.css`'s palette as literals — the two are kept in step
  by hand, because `tokens.css` is bundled into the app's hashed stylesheet and cannot be
  linked from a plain HTML file. If a colour moves there, move it here.
- **They carry no script at all**, which keeps them inside the CSP without any widening,
  and keeps them readable to a crawler that does not run JavaScript.
- **The rewrite has to let them through.** The negative lookahead in `vercel.json` now
  excludes their slugs by prefix (`walkingpad-` covers three of them). Vercel checks the
  filesystem before applying rewrites, so a real file would most likely win regardless, but
  naming the exclusions removes the dependency on that ordering — and makes the next person
  adding a page notice that there is something to update.

Adding a page means five edits, and the last is the one that gets forgotten: the file
itself, the slug in the `vercel.json` rewrite lookahead, the slug again in the `vercel.json`
cache header, an entry in `sitemap.xml`, and a link to it from somewhere — the static intro
in `index.html` and the footer of each existing page. A page nothing links to is a page
nothing finds.

The two `vercel.json` edits are spelled differently on purpose. The rewrite's negative
lookahead takes a `walkingpad-` prefix, but the header's `source` cannot: Vercel parses it
as a path pattern rather than a regex, and rejects a nested group — `walkingpad-(.*)`
inside an alternation fails the deployment outright with *invalid `source` pattern*. So the
header lists every slug flat, in the same shape as the `index.html|sw.js|…` entry above it.
Nothing in a local build catches this; only a deploy does.

## What is not in the repository

Two things that matter to search live outside it, and neither can be committed:

- **Search Console and Bing Webmaster Tools.** Verify by DNS TXT record at Cloudflare
  rather than by a meta tag, which keeps `index.html` and the CSP out of it, then submit
  the sitemap and request indexing for the new pages. Nothing here ranks until it is
  indexed, and impressions per query is the only honest signal for the first couple of
  months — clicks lag it badly on a new domain.
- **Anything pointing at the domain.** The pages above make the site rankable; they do not
  make it rank. That is links, and links come from the places the audience already is.

## The domain

Production is **`beltcontrol.com`**, registered at Cloudflare. Two things about that are load
bearing rather than cosmetic:

- **The origin is the database.** Session history lives in `localStorage` and the installed
  PWA's identity is its origin, so moving the app to a different hostname later strands every
  user's history and orphans every home-screen install. Treat the domain as permanent.
- **HTTPS is a hard requirement, not a preference.** Web Bluetooth refuses to run outside a
  secure context. `.app` is HSTS-preloaded by the registry and would have enforced this for
  free; `.com` is not, so `vercel.json` sends `Strict-Transport-Security` itself. Without it
  the first hit of a session goes out in plaintext and the page is briefly, silently
  non-functional before the redirect lands.

  Vercel does send HSTS of its own accord on `*.vercel.app`, which is what made this easy
  to believe was already handled — this file claimed the header for some time without
  actually carrying it. Do not infer a custom apex from a preview URL: check the domain
  you actually ship on.

  ```sh
  curl -sI https://beltcontrol.com/ | grep -i strict-transport-security
  ```

In Cloudflare's DNS panel the records must be **DNS-only (grey cloud), not proxied**. Proxying
Cloudflare in front of Vercel interferes with certificate issuance and renewal, and with the
default *Flexible* SSL mode produces a redirect loop. If you deliberately want the orange
cloud, SSL/TLS mode has to be **Full (strict)**.

```sh
npx vercel domains add beltcontrol.com
npx vercel domains inspect beltcontrol.com   # prints the exact records to paste into Cloudflare
```

Use whatever `inspect` reports rather than a remembered IP — Vercel's published apex A record
has changed before.

## Deployment privacy

A Vercel deployment URL is public by default. Nothing sensitive is exposed — the page is inert
without a treadmill in radio range, and session history never leaves the browser — but you can
turn on Deployment Protection on the project if you'd rather it not be reachable at all.

What *does* leave the browser is the analytics beacon. `@vercel/analytics` is mounted in
`app.tsx` and posts page views to Vercel Web Analytics: no cookies, no cross-site tracking, but
still a request, and Vercel keeps ordinary request logs including IP addresses like any host.
That is disclosed on the in-app legal page (`#/legal`) under **What is collected**, and the two
have to stay in step — a privacy claim the deployment quietly contradicts is worse than no claim
at all. If you fork this and drop the analytics import, edit that section to match; if you add
anything that talks to a third party, the CSP in `vercel.json` will block it until you widen
`connect-src`, which is the moment to update the page as well.
