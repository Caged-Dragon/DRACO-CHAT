# Layout tests (visual + overlap)

Renders the real app in headless Chromium against a **mocked Supabase** (no account needed)
and checks it at phone, tablet and desktop sizes.

```bash
pip install playwright && python -m playwright install chromium
VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mock npm run build
python tests/ui/overlap.py       # fails if any row has overlapping children or sideways scrolling
python tests/ui/screenshots.py /tmp/ui-shots   # saves screenshots at 7 sizes to look at
```
