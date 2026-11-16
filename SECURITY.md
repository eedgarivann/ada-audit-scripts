# Security policy

Supported version: latest tagged release (currently 4.2.x). Dependencies are pinned; update them with tests, not an unreviewed lockfile bump.

## Report a vulnerability privately
Use [GitHub private vulnerability reporting](https://github.com/eedgarivann/ada-audit-scripts/security/advisories/new). Do not open a public issue with an exploit, credential, private URL or a site's audit output. If private reporting is unavailable, open a public issue asking for a private channel without including details.

## Threat model and limits
This tool visits URLs you give it, executes their JavaScript in Chromium and writes their HTML-derived evidence to disk. Run only on sites you own or are authorized to test, on a machine/container whose network access is appropriate. Do not feed untrusted URL lists to a runner with access to private networks, cloud metadata or sensitive files. Playwright browser isolation is not a sandbox for hostile code.

`safePage` blocks service workers and non-GET/HEAD/OPTIONS requests, including in popups. That protects against many accidental writes, **not all side effects**: a GET link can log out, unsubscribe or add to a cart. Do not run authenticated or sensitive sessions; do not pass side-effecting URLs or clicks. Test final actions only on owner-approved staging/test accounts by hand.

Audit output can contain page content, screenshots, selectors and URLs (including query strings). Treat it as potentially private: store it locally, redact before sharing, and do not commit it. `audit-output/` is git-ignored; that is a convenience, not a data-loss prevention control. Reports escape HTML and CSV is quoted, but spreadsheet apps may interpret cells beginning with `=`, `+`, `-` or `@` as formulas: import CSV as text.

The CLI should run as an unprivileged user. No credentials are required for offline tests or normal public-page audits. CI runs fictional fixtures only and has read-only repository permissions.
