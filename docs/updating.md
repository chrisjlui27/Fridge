# Shipping an update to the fridge

How a change gets from a branch to your family's phones, safely.

```
work branch ──push──▶ Vercel Preview (test backend) ──you try it──▶ merge into main ──▶ Production (your family)
```

- **`main` is the live app.** Only `main` deploys to Production, which is your real Convex backend and data.
- **Every other branch gets a Preview**: its own link, running against your Convex *development* (test) backend.
- **You decide when it goes live** by merging the pull request.

## The short version

1. Claude opens a pull request on GitHub.
2. You press **Merge pull request**, then **Confirm merge**.
3. Wait about 2 minutes while Vercel deploys.
4. On your phone, open the app and tap **Refresh** on the "new version" banner. (For the very first update, fully close the app and reopen it instead.)

If anything looks wrong afterwards: Vercel → Deployments → the previous one → **⋯ → Instant Rollback**. Your data is never touched.

Everything below is optional, for trying changes on a preview before they go live.

## One-time setup (about 10 minutes)

### 0–1. `main` exists and is Vercel's production branch (done)

Vercel → Settings → Environments → Production → Branch Tracking is set to `main`.

### 2. (Optional) Give previews a test backend

Vercel → your project → **Settings → Environment Variables**:

1. Find `CONVEX_DEPLOY_KEY` (your **production** key, already there). Make sure it's ticked for **Production only**. If it says "All Environments", edit it and untick Preview and Development.
2. Create a key for your **development** (test) deployment:

   ```bash
   npx convex deployment token create vercel-preview --deployment dev
   ```

   You can also get one from the Convex dashboard: switch to your *development* deployment → Settings → Deploy keys → Generate. If the command says there's no dev deployment, run `npx convex dev` once to create one.
3. Add `CONVEX_DEPLOY_KEY` **again**, ticked for **Preview only**, with that development key as the value.

Previews now update your test backend and never touch your family's data. (Convex also sells "preview deploy keys" that make a fresh backend per branch, but they need a paid plan; you don't need them.)

### 3. (Optional) Make `main` the default branch on GitHub

GitHub → the repo → **Settings → General → Default branch** → `main`. Pull requests then point at `main` automatically.

## Each update

1. **The change lands on a work branch** (for example `ccr-d2a1e7e7-juboqv`).
2. **Vercel builds a Preview.** The link shows up on the commit or pull request in GitHub, and under Vercel → Deployments. Vercel may ask you to log in to view it; that's its Deployment Protection keeping previews private.
3. **Try it.** A preview uses the test backend, so the first time you'll see the setup screen. Make a throwaway household ("Test House") and click around. Don't add the preview to your Home Screen.
4. **Open a pull request** from the work branch into `main` (or ask Claude to open one), then **Merge**.
5. **Vercel builds Production** (1–2 minutes). The build runs `npx convex deploy` first, which updates the backend, and then publishes the new app.
6. **On your phone:** open the fridge. A banner says **"✨ A new version of the fridge is ready"**. Tap **Refresh**. The app checks for updates when you open it and every 30 minutes while it's open.
7. **Check it landed:** **Me → This device → App version** shows the build date and the commit (the first 7 characters of the merge commit in GitHub).

### The very first update only

The version on your phone now is older than the banner. After the first update is live, **fully close the app (swipe it away in the app switcher) and open it again**. Once is usually enough, sometimes twice. After that, the banner takes care of it.

## If something goes wrong

- **The app looks broken:** Vercel → Deployments → the previous Production deployment → **Instant Rollback**. That's immediate, and the backend and data are untouched.
- **Undo a change completely:** on the merged pull request in GitHub, press **Revert**, then merge the revert pull request. Vercel redeploys the previous code, backend included.
- **Phones on an older version keep working.** Changes are kept backward-compatible (new fields are optional, old functions stay), so a phone that hasn't refreshed yet doesn't break.
- **Your data is never rolled back** by a deploy. For a copy: Family settings → Your data → Download, or `npx convex export --prod --include-file-storage --path backup.zip`.

## The safety guard

`vercel.json` runs `scripts/vercel-ignore-build.sh` before every Vercel build. It **skips any Production build that isn't from `main`**. Until you've done step 1, pushes to a work branch can't change the live app; Vercel lists them as "Canceled by Ignored Build Step". As a second safety net, the Convex CLI itself refuses to use a production key from a Preview build.
