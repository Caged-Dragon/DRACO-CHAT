import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { compressImage } from '../utils/image.js';
import { useAuth } from './AuthContext.jsx';
import { computeGradient } from '../theme/fields.js';
import { defaultsFor } from '../theme/palettes.js';
import { applyMode, getStoredMode } from '../theme/mode.js';
import { safeFileName } from '../utils/upload.js';

const ThemeContext = createContext(null);

// Only colours the person explicitly customised are written onto <html>. Everything else
// comes from the stylesheet for the current mode (dark by default, light on request), so
// switching modes always works and "reset" simply removes the overrides.
let appliedKeys = new Set();

function applyToRoot(overrides, wallpaperUrl, defaults) {
  const style = document.documentElement.style;
  const next = new Set();
  Object.entries(overrides).forEach(([key, value]) => {
    if (value && key.startsWith('--')) {
      style.setProperty(key, value);
      next.add(key);
    }
  });
  const gradient = computeGradient(overrides, defaults);
  if (gradient) {
    style.setProperty('--gradient', gradient);
    next.add('--gradient');
  }
  appliedKeys.forEach((key) => {
    if (!next.has(key)) style.removeProperty(key);
  });
  appliedKeys = next;
  style.setProperty('--wallpaper-image', wallpaperUrl ? `url("${wallpaperUrl}")` : 'none');
}

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState(getStoredMode);
  const [theme, setTheme] = useState({}); // customised colours only
  const [wallpaperUrl, setWallpaperUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const defaults = defaultsFor(mode);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // Re-apply customisations whenever they, the wallpaper or the mode change
  useEffect(() => {
    applyToRoot(theme, wallpaperUrl, defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, wallpaperUrl, mode]);

  useEffect(() => {
    if (!user) {
      setTheme({});
      setWallpaperUrl(null);
      setLoaded(false);
      return;
    }
    supabase
      .from('chat_user_settings')
      .select('theme, wallpaper_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setTheme(data?.theme && typeof data.theme === 'object' ? data.theme : {});
        setWallpaperUrl(data?.wallpaper_url ?? null);
        setLoaded(true);
      });
  }, [user]);

  function setMode(next) {
    setModeState(next === 'light' ? 'light' : 'dark');
  }
  function toggleMode() {
    setModeState((m) => (m === 'dark' ? 'light' : 'dark'));
  }

  // Merge in a partial set of changed colours, apply immediately, and persist
  // the customised colours to Supabase.
  async function updateTheme(partial) {
    const merged = { ...theme, ...partial };
    setTheme(merged);
    const { error } = await supabase
      .from('chat_user_settings')
      .upsert({ user_id: user.id, theme: merged, updated_at: new Date().toISOString() });
    return { error };
  }

  async function uploadWallpaper(rawFile) {
    const file = await compressImage(rawFile, { maxDim: 1920, quality: 0.8 });
    const path = `${user.id}/global-${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from('chat-wallpapers')
      .upload(path, file, { upsert: true });
    if (uploadError) return { error: uploadError };

    const { data: pub } = supabase.storage.from('chat-wallpapers').getPublicUrl(path);
    const url = pub.publicUrl;
    setWallpaperUrl(url);
    const { error } = await supabase
      .from('chat_user_settings')
      .upsert({ user_id: user.id, wallpaper_url: url, updated_at: new Date().toISOString() });
    return { error, url };
  }

  async function clearWallpaper() {
    setWallpaperUrl(null);
    const { error } = await supabase
      .from('chat_user_settings')
      .upsert({ user_id: user.id, wallpaper_url: null, updated_at: new Date().toISOString() });
    return { error };
  }

  async function resetTheme() {
    setTheme({});
    setWallpaperUrl(null);
    const { error } = await supabase
      .from('chat_user_settings')
      .upsert({ user_id: user.id, theme: {}, wallpaper_url: null, updated_at: new Date().toISOString() });
    return { error };
  }

  return (
    <ThemeContext.Provider
      value={{
        mode, setMode, toggleMode, defaults,
        theme, wallpaperUrl, loaded,
        updateTheme, uploadWallpaper, clearWallpaper, resetTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
