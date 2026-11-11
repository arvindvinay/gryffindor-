# gryffindor-

This repo includes a copy of [public-apis/public-apis](https://github.com/public-apis/public-apis)
(MIT licensed) in the `public-apis/` folder, added with `git subtree`.

To pull the latest updates from the original repo:

```bash
git subtree pull --prefix=public-apis https://github.com/public-apis/public-apis master --squash
```

## Automatic updates

A GitHub Actions workflow (`.github/workflows/sync-public-apis.yml`) checks the
original repo every day and commits any new changes into `public-apis/`.
You can also run it by hand from the **Actions** tab → **Sync public-apis** → **Run workflow**.
