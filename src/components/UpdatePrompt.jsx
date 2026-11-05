import { useEffect, useState } from 'react';

// When a new version of the app has been installed in the background, offer
// a one-tap reload (the new code only runs after the page is reloaded).
export default function UpdatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    // On the very first visit there is no controller yet; ignore that change.
    const hadController = !!navigator.serviceWorker.controller;
    const onChange = () => {
      if (hadController) setShow(true);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);

  if (!show) return null;
  return (
    <div className="update-prompt" role="status">
      <span>A new version of Dragon Chat is ready.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" className="update-later" onClick={() => setShow(false)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
