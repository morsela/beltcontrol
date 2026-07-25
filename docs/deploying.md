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
| `Permissions-Policy: bluetooth=(self)` | Keeps the radio available to this origin and nothing it embeds. |
| `Strict-Transport-Security` | Web Bluetooth needs a secure context; this makes downgrade to plain HTTP a non-option. |
| `X-Content-Type-Options`, `Referrer-Policy` | Ordinary hardening. Nothing here is sensitive, but nothing here needs a referrer either. |
| `rewrites` → `/index.html` | Hash routing means the server only ever needs to serve the shell; the negative lookahead keeps real files (assets, icons, the manifest) being served as themselves. |

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
