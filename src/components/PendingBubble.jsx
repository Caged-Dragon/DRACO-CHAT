import { discardOutboxItem, retryOutboxItem } from '../utils/outbox.js';

// A message that hasn't been delivered yet (offline / sending / failed).
export default function PendingBubble({ item, userId }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div className="bubble-row mine pending-row">
      <div className="bubble-stack">
        <div className={`bubble mine pending${item.failed ? ' failed' : ''}`}>
          <div className="bubble-text">{item.preview}</div>
          <div className="bubble-meta pending-meta">
            {item.failed ? (
              <>
                <span>⚠️ Not sent — {item.failed}</span>
                <button type="button" onClick={() => retryOutboxItem(userId, item.id)}>
                  Retry
                </button>
                <button type="button" onClick={() => discardOutboxItem(userId, item.id)}>
                  Delete
                </button>
              </>
            ) : (
              <span>🕓 {offline ? 'Waiting for connection…' : 'Sending…'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
