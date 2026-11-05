import { useEffect } from 'react';

// Makes every pop-up (`.modal-overlay` > `.modal-card`) accessible without
// touching each modal's own code:
//  - marks it as a dialog (role, aria-modal, labelled by its heading)
//  - moves keyboard focus into it, keeps Tab inside it, returns focus on close
//  - Escape closes the top-most one (by pressing its own close button)
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalA11y() {
  useEffect(() => {
    let lastFocus = null;
    let hadModal = false;

    const overlays = () => [...document.querySelectorAll('.modal-overlay')];
    const topCard = () => {
      const all = overlays();
      return all.length ? all[all.length - 1].querySelector('.modal-card') : null;
    };
    const visibleFocusables = (root) =>
      [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

    function scan() {
      const all = overlays();
      if (all.length && !hadModal) {
        lastFocus = document.activeElement;
        hadModal = true;
      }
      all.forEach((overlay) => {
        const card = overlay.querySelector('.modal-card');
        if (!card || card.dataset.a11y) return;
        card.dataset.a11y = '1';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('tabindex', '-1');
        const heading = card.querySelector('h1, h2, h3');
        if (heading) {
          if (!heading.id) heading.id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
          card.setAttribute('aria-labelledby', heading.id);
        }
        requestAnimationFrame(() => {
          if (!card.contains(document.activeElement)) {
            (visibleFocusables(card)[0] || card).focus?.();
          }
        });
      });
      if (!all.length && hadModal) {
        hadModal = false;
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.();
        lastFocus = null;
      }
    }

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();

    function onKeyDown(e) {
      const card = topCard();
      if (!card) return;
      if (e.key === 'Escape') {
        const close = card.querySelector('.modal-close');
        if (close) {
          e.preventDefault();
          close.click();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const items = visibleFocusables(card);
      if (items.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!card.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
