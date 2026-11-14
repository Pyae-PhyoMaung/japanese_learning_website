/* Cloud sync & file storage — powered by Supabase (free tier).
   Setup steps are in README.md. Leave url/key EMPTY to run fully offline:
   the site still works, but progress and files stay on this device only. */
window.JL_CLOUD = {
  url: '',                 /* e.g. 'https://abcd1234.supabase.co' (Project URL, no trailing slash) */
  key: '',                 /* your project's anon / public API key */
  user: 'main',            /* single-user profile key — change it to any unguessable string */
  bucket: 'jl-files'       /* storage bucket you created in Supabase */
};