import { useRef, useState } from 'react';
import { useStatus } from '../contexts/StatusContext.jsx';

const BG_COLORS = ['#8a5a00', '#111111', '#b91c1c', '#c2410c', '#15803d', '#0e7490', '#6d28d9', '#be185d'];
const MAX_STATUS_BYTES = 15 * 1024 * 1024;

export default function AddStatusModal({ onClose }) {
  const { postTextStatus, postImageStatus } = useStatus();
  const [mode, setMode] = useState('text'); // 'text' | 'image'
  const [text, setText] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[5]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  function handleImagePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_STATUS_BYTES) {
      setError('Image is too large (max 15MB).');
      return;
    }
    setError('');
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setMode('image');
  }

  async function handlePost() {
    setError('');
    setBusy(true);

    if (mode === 'text') {
      if (!text.trim()) {
        setError('Write something first.');
        setBusy(false);
        return;
      }
      const { error } = await postTextStatus(text, bgColor);
      if (error) setError(error.message);
      else onClose();
    } else {
      if (!imageFile) {
        setError('Choose an image first.');
        setBusy(false);
        return;
      }
      const { error } = await postImageStatus(imageFile, caption);
      if (error) setError(error.message);
      else onClose();
    }
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card status-add-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add status</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="status-mode-tabs">
          <button
            type="button"
            className={`theme-tab ${mode === 'text' ? 'active' : ''}`}
            onClick={() => setMode('text')}
          >
            🔤 Text
          </button>
          <button
            type="button"
            className={`theme-tab ${mode === 'image' ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            🖼️ Photo
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} hidden />

        {mode === 'text' ? (
          <>
            <div className="status-text-preview" style={{ background: bgColor }}>
              <span>{text || 'Type a status...'}</span>
            </div>
            <textarea
              className="report-textarea"
              placeholder="What's on your mind?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={2}
            />
            <div className="status-color-swatches">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`status-color-swatch ${bgColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setBgColor(c)}
                  aria-label={`Background ${c}`}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {imagePreview && <img src={imagePreview} alt="Preview" className="status-image-preview" />}
            <input
              type="text"
              placeholder="Add a caption (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={150}
            />
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="modal-footer">
          <span />
          <button type="button" onClick={handlePost} disabled={busy}>
            {busy ? 'Posting...' : 'Post status'}
          </button>
        </div>
      </div>
    </div>
  );
}
