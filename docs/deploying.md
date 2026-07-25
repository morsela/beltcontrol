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
| `sw.js` cache name is stamped at build time | `VERSION` in `sw.js` carries a hash of the emitted asset filenames, injected by the `stamp-service-worker` plugin in `vite.config.ts`. It was a hand-written constant that never moved, which left the worker's `activate` handler — delete every cache that is not `VERSION` — with nothing to delete on any deploy. |
| `Content-Security-Policy` | The one header that is load bearing rather than ordinary hardening — see below. |
| `X-Frame-Options: DENY` | Same intent as `frame-ancestors 'none'`, for browsers that predate it. |
| `Permissions-Policy: bluetooth=(self)` | Keeps the radio available to this origin and nothing it embeds. |
| `Strict-Transport-Security` | Web Bluetooth needs a secure context; this makes downgrade to plain HTTP a non-option. `.com` is not HSTS-preloaded by the registry, so this header is the only thing enforcing it. |
| `X-Content-Type-Options`, `Referrer-Policy` | Ordinary hardening. Nothing here is sensitive, but nothing here needs a referrer either. |
| `robots.txt`, `sitemap.xml` → `max-age=3600` | Crawlers re-read them often; an hour is short enough to fix a mistake and long enough to matter. |
| icons and `og.png` → `max-age=604800` | Unfingerprinted but near-immutable. A week means a redesign lands within a week rather than never. |
| `rewrites` → `/index.html` | Hash routing means the server only ever needs to serve the shell; the negative lookahead keeps real files (assets, icons, the manifest) being served as themselves. |

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
leans on: the inline `<style>` behind the `<noscript>` fallback is covered by
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
- **`<noscript>` holds a real page**, not a one-line apology. Firefox and Safari users cannot
  run this app at all, and they arrive anyway; the fallback tells them why, and gives a
  crawler prose to index on a page that is otherwise an empty `<div>`.

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
