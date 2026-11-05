import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'entry.jsx')],
  bundle: true,
  outfile: path.join(here, 'dist', 'bundle.js'),
  format: 'iife',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
  plugins: [
    {
      name: 'test-doubles',
      setup(b) {
        // swap the real Supabase client and auth context for in-memory doubles
        b.onResolve({ filter: /supabaseClient(\.js)?$/ }, () => ({ path: path.join(here, 'fakeSupabase.js') }));
        b.onResolve({ filter: /AuthContext\.jsx$/ }, () => ({ path: path.join(here, 'authStub.jsx') }));
      },
    },
  ],
});
console.log('bundle built');
