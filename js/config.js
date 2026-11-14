/* Cloud sync & file storage — powered by Supabase (free tier).
   Setup steps are in README.md. Leave url/key EMPTY to run fully offline:
   the site still works, but progress and files stay on this device only. */
window.JL_CLOUD = {
  url: 'https://xntlkyjjxhtmojaamxvc.supabase.co',
  key: 'sb_publishable_lShSA_dy3AYAGRx0Qy_p8Q_nKJTLyBw',   /* publishable key — safe for browsers */
  user: 'main',            /* single-user profile key — change it to any unguessable string */
  bucket: 'jl-files'       /* storage bucket you created in Supabase */
};