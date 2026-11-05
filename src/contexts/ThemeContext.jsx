import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/image.js';
import { useAuth } from './AuthContext.jsx';
import { DEFAULT_THEME, computeGradient } from '../theme/fields.js';

const ThemeContext = createContext(null);

function applyToRoot(theme, wallpaperUrl) {
  const root = document.documentElement.style;
  Object.entries(theme).forEach(([key, value]) => {
    if (value) root.setProperty(key, value);
  });
  const gradient = computeGradient(theme);
  if (gradient) root.setProperty('--gradient', gradient);
  root.setProperty('--wallpaper-image', wallpaperUrl ? `url("${wallpaperUrl}")` : 'none');
}

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [wallpaperUrl, setWallpaperUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setTheme(DEFAULT_THEME);
      setWallpaperUrl(null);
      applyToRoot(DEFAULT_THEME, null);
      setLoaded(false);
      return;
    }

    supabase
      .from('user_settings')
      .select('theme, wallpaper_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const merged = { ...DEFAULT_THEME, ...(data?.theme ?? {}) };
        setTheme(merged);
        setWallpaperUrl(data?.wallpaper_url ?? null);
        applyToRoot(merged, data?.wallpaper_url ?? null);
        setLoaded(true);
      });
  }, [user]);

  // Merge in a partial set of changed colors, apply immediately, and
  // persist the full merged theme to Supabase.
  async function updateTheme(partial) {
    const merged = { ...theme, ...partial };
    setTheme(merged);
    applyToRoot(merged, wallpaperUrl);

    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, theme: merged, updated_at: new Date().toISOString() });
    return { error };
  }

  async function uploadWallpaper(rawFile) {
    const file = await compressImage(rawFile, { maxDim: 1920, quality: 0.8 });
    const path = `${user.id}/global-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-wallpapers')
      .upload(path, file, { upsert: true });
    if (uploadError) return { error: uploadError };

    const { data: pub } = supabase.storage.from('chat-wallpapers').getPublicUrl(path);
    const url = pub.publicUrl;

    setWallpaperUrl(url);
    applyToRoot(theme, url);

    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, wallpaper_url: url, updated_at: new Date().toISOString() });
    return { error, url };
  }

  async function clearWallpaper() {
    setWallpaperUrl(null);
    applyToRoot(theme, null);
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, wallpaper_url: null, updated_at: new Date().toISOString() });
    return { error };
  }

  async function resetTheme() {
    setTheme(DEFAULT_THEME);
    setWallpaperUrl(null);
    applyToRoot(DEFAULT_THEME, null);
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        theme: {},
        wallpaper_url: null,
        updated_at: new Date().toISOString(),
      });
    return { error };
  }

  return (
    <ThemeContext.Provider
      value={{ theme, wallpaperUrl, loaded, updateTheme, uploadWallpaper, clearWallpaper, resetTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
