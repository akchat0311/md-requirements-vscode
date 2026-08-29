# Publishing to the VS Code Marketplace (and Open VSX)

Publishing is **free**; there is no fee and no human review gate (automated
malware scanning only). Total time: ~10 minutes the first time.

## One-time setup

1. **Create a publisher** at <https://marketplace.visualstudio.com/manage>
   (sign in with any Microsoft account). Pick a publisher ID — e.g.
   `akchat` — and make sure `packages/extension/package.json` `"publisher"`
   matches it exactly.
2. **Create a Personal Access Token (PAT)**:
   - Go to <https://dev.azure.com> → your profile → *Personal access
     tokens* → *New token*.
   - Organization: **All accessible organizations**. Scopes: *Custom
     defined* → **Marketplace → Manage**.
   - Copy the token (shown once).

## Before the first publish

In `packages/extension/package.json`:

- [ ] Remove `"private": true`.
- [ ] Add `"repository": { "type": "git", "url": "https://github.com/akchat0311/md-requirements-vscode" }`.
- [ ] Add a `LICENSE` file at the repo root (MIT is conventional) and
      `"license": "MIT"` in the manifest.
- [ ] Add an `"icon": "icon.png"` (128×128 PNG in packages/extension/).
- [ ] Optional: `"keywords"`, `"galleryBanner"`.

## Publish

```bash
cd packages/extension
npm run build --workspaces --if-present   # from the repo root first
npx @vscode/vsce publish --no-dependencies -p <YOUR_PAT>
```

The extension is listed publicly within minutes. Subsequent releases:
bump `"version"` and run the same command (`vsce publish patch` bumps for
you).

## Open VSX (VSCodium, Gitpod, Cursor-family editors)

1. Create an account + token at <https://open-vsx.org> (Eclipse Foundation,
   free; sign the publisher agreement once).
2. ```bash
   npx ovsx publish md-requirements-editor-<version>.vsix -p <OVSX_TOKEN>
   ```

## Verified publisher (optional)

In the Marketplace management page, add your domain and a DNS TXT record to
get the blue "verified" checkmark. Free.
