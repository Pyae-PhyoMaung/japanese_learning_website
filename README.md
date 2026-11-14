# 日本語 Japanese Learning Website (JLPT N5)

A static multi-page study site: textbook reader (PDF), kanji & vocab with writing practice, grammar, listening dictation, quizzes/flashcards, a rule-based study partner, and personal file uploads. No server required — it runs entirely in the browser, with optional cloud sync via Supabase.

## 1. Publish to GitHub Pages

1. Create a **public** GitHub repository (e.g. `japanese-learning`, or `<your-name>.github.io` for a root site).
2. Push everything in this folder **except** `app.py`, `app.yaml`, `requirements.txt` (those were only for the old Databricks App deployment).
3. In the repo: Settings → Pages → Source: *Deploy from a branch* → Branch: `main` + `/ (root)` → Save.
4. Your site is live at `https://<your-name>.github.io/japanese-learning/` within a few minutes.

> Note: GitHub Pages (free) requires a public repository, so the two textbook PDFs will be publicly downloadable. If that matters, use Vercel instead (free tier can deploy from a private repo).

## 2. Enable cloud sync + file upload/download (Supabase, free)

Without this the site works fine, but everything stays on one device.

1. Create a free project at [supabase.com](https://supabase.com) (may pause after 1 week of inactivity — just restore it).
2. Copy your **Project URL** and **anon public key** from Project Settings → API.
3. In SQL Editor, run:

```sql
create table if not exists user_data (
  user_id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table user_data enable row level security;
create policy "jl read" on user_data for select to anon, authenticated using (true);
create policy "jl write" on user_data for insert to anon, authenticated with check (true);
create policy "jl update" on user_data for update to anon, authenticated using (true);
```

4. Storage → New bucket → name it `jl-files` (keep it **private**).
5. Storage → Policies (`jl-files` bucket) → New policy → **Full access** (or run in SQL Editor):

```sql
create policy "jl files all" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'jl-files')
  with check (bucket_id = 'jl-files');
```

6. Edit `js/config.js`: fill `url` and `key`, optionally change `user` to an unguessable string, commit and push. Done — uploads, downloads and progress now sync across devices.

> Privacy trade-off: this is a single-user personal site without login. Anyone who finds your Supabase URL + key (visible in the site source) could read/write your study data. The unguessable `user` value keeps casual visitors out of your data, but it is not real security. Don't store anything sensitive here.

## How sync works

- Progress, edits, preferences and file *metadata* live in one `user_data` row (pushed ~1.5 s after every change; pulled on load, on navigation and every 30 s; last-write-wins across devices).
- File *blobs* live in the `jl-files` bucket (`<user>/<file-id>`), capped at 40 MB per file; larger files stay on the uploading device only.
- Audio uses your browser/device Japanese voice (no server needed).

## Local development

Just open `index.html` in a browser, or run `python -m http.server` in this folder and visit `http://localhost:8000`.