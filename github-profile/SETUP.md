# Publishing the profile README

GitHub shows a special repository on your profile page: one named exactly after your username.

## Steps

1. Create a **public** repository named `crafillio` (same as the username).
   GitHub will offer "You found a secret!" — that is the right repo.
2. Copy `README.md` from this folder into it as the repository's `README.md`.
3. Push. It appears at <https://github.com/crafillio> immediately.

```bash
gh repo create crafillio --public --description "Profile"
git clone https://github.com/crafillio/crafillio.git
cp github-profile/README.md crafillio/README.md
cd crafillio && git add README.md && git commit -m "Add profile README" && git push
```

## Before you push

The README has a commented block near the bottom marked **FILL THESE IN**. Those are the
personal details I deliberately left blank rather than inventing: what you are working on,
what to ask you about, and how to reach you. Complete or delete that block.

## The logo

The header image points at `docs/assets/mark.svg` in the `crafillio-devkit` repository, so it
only renders once that repo is public and pushed. If you would rather not couple the two, copy
`mark.svg` into the profile repo and change the `src` to `mark.svg`.

## The showcase page

`docs/index.html` in `crafillio-devkit` is a self-contained showcase of your tools. To serve it:

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder: `/docs`.

It will be at `https://crafillio.github.io/crafillio-devkit/`. Regenerate it any time with:

```bash
npm run site
```
