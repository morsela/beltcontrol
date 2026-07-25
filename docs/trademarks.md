# Trademarks and independence

This project is not affiliated with, endorsed by, or sponsored by Beijing KingSmith
Technology Co., Ltd.

**WalkingPad®** and **KingSmith®** are trademarks of Beijing KingSmith Technology Co., Ltd.
(US Reg. 5815598 and 5815901, the latter covering downloadable mobile software). They appear
in this repository only where they are the accurate name of a thing being described — the
treadmills the app connects to, the `KS+Fit` app whose behaviour was analysed, the
`WalkingPad (classic fe00)` protocol family, the BLE advertised-name prefixes in
`src/state/connection.ts`. That is nominative use: there is no way to say what this software
is compatible with without naming the products.

What the project therefore does **not** do, deliberately:

- take the mark as its own product name, in the UI, the manifest, or a domain
- use KingSmith's logo, wordmark, colours or other trade dress
- present itself as official, licensed, or a replacement supported by the manufacturer
- charge for anything, carry advertising, or otherwise trade on the brand

The protocol work is clean-room-adjacent interoperability analysis of BLE traffic and a
publicly distributed binary, done to make hardware the author owns talk to software the
author wrote. Nothing from KS+Fit is redistributed here — see
[Reproducing the analysis](protocols.md#reproducing-the-analysis), which tells you how to
obtain the APK yourself rather than shipping it.

If you fork this, keep the disclaimer in `src/components/Disclaimer.tsx` rendered, and keep the
`NOTICE` file. Under section 4(d) of the Apache-2.0 licence the project ships under, reproducing
`NOTICE` in a derivative work is a licence condition, not a courtesy — which is the one part of
this page that survives a fork whether or not the forker reads it.

The same statement is repeated at length on the in-app legal page
(`#/legal`, `src/routes/Legal.tsx`), alongside the safety, warranty and privacy terms. Three
places, deliberately: the footer is what a user passes, the legal page is what a user is sent to,
and `NOTICE` is what a fork is obliged to carry.
