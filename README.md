# Last Z Helper

just playing around

This repository is a repaired static mirror of `https://lastz.stresswar.com/`.

The original backup was captured with `wget`. The site is a React Router SSR/static app with lazy route discovery, so a plain mirror missed a few things that matter for local static hosting:

- clean route files for paths like `/tank` and `/research/unit-special-training`
- the React Router route discovery endpoint at `/__manifest`
- React Router `.data` payloads used during client-side navigation
- several lazy or PWA assets used by calculators, heroes, and the web manifest

## Run Locally

Use any static server from the repository root. The included server has no dependencies:

```bash
npm run serve
```

Then open:

```text
http://localhost:4173/
```

Direct route URLs such as these should work:

```text
http://localhost:4173/tank
http://localhost:4173/research
http://localhost:4173/research/unit-special-training
```

Python's built-in server also works for the repaired directory routes:

```bash
python -m http.server 4173
```

## Incremental Live Sync

The mirror includes a targeted updater for checking the original live site without running a fresh `wget` mirror:

```bash
npm run sync:live
```

For a no-write preview:

```bash
npm run sync:live:dry
```

The sync command checks known routes, React Router `.data` payloads, `__manifest`, and referenced static assets from `https://lastz.stresswar.com/`. It stores remote `ETag` and `Last-Modified` metadata in `.lastz-live-state.json`, so future runs can skip files that have not changed. When a route HTML file changes, the script re-applies the static-hosting fixes used by this mirror, including route `index.html` files, the root `<base>` tag, and removal of Cloudflare challenge snippets that do not belong in the static copy.

After a sync, review the diff and deploy only if there are real changes:

```bash
git status --short
git diff --stat
git add .
git commit -m "Sync live site updates"
git push
```

## Static Deployment

For GitHub Pages:

1. Push this repository to GitHub.
2. In repository settings, enable Pages from the `main` branch and repository root.
3. Keep `.nojekyll` in the repository. It prevents GitHub Pages from dropping `__manifest`.

This mirror is easiest to deploy at a domain root, such as a custom domain or user/organization Pages site. The recovered JavaScript bundles use root-relative paths like `/assets/...`, so a project Pages URL under `/repo-name/` may need a custom domain or additional path rewriting.

## Known Limitations

Most calculator, tracker, research tree, and local-storage features are client-side and work offline once the static assets load.

The feedback page is not fully static. It depends on live/backend behavior:

- Cloudflare Turnstile script loading
- a server-side feedback form action
- server-side validation and submission

The form UI can render locally, but actual feedback submission is not expected to work from a static mirror.
