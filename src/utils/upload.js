import * as tus from 'tus-js-client';
import { supabase } from '../supabaseClient';

// Largest file a person can share in a chat. The chat-attachments bucket is configured
// with the same limit (104857600 bytes) in supabase/schema.sql.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENT_LABEL = '100MB';

// Below this size a single request is fine; above it we use resumable (TUS) uploads so a
// dropped connection continues where it stopped instead of starting over.
const RESUMABLE_FROM = 6 * 1024 * 1024;
const CHUNK_SIZE = 6 * 1024 * 1024; // Supabase requires exactly 6MB chunks

// Storage object keys reject spaces / non-ASCII in some cases. Keep the readable part,
// drop the rest. The original name is still stored on the message for display.
export function safeFileName(name = 'file') {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const clean = (s) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const b = clean(base).slice(0, 80) || 'file';
  const e = clean(ext).slice(0, 10);
  return e ? `${b}.${e}` : b;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function resumableEndpoint(rawUrl = import.meta.env.VITE_SUPABASE_URL || '') {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.endsWith('.supabase.co')) {
      // Large uploads are faster and more reliable on the dedicated storage hostname
      return `https://${u.hostname.split('.')[0]}.storage.supabase.co/storage/v1/upload/resumable`;
    }
  } catch {
    /* fall through */
  }
  return `${String(rawUrl).replace(/\/$/, '')}/storage/v1/upload/resumable`;
}

/**
 * Upload `file` to `bucket/path`. Resolves to { error: null } or { error: { message, cancelled? } }.
 * `onProgress(0-100)` is called as bytes are sent; pass an AbortSignal to cancel.
 */
export async function uploadToBucket({ bucket, path, file, contentType, onProgress, signal }) {
  const type = contentType || file.type || 'application/octet-stream';
  if (signal?.aborted) return { error: { message: 'Upload cancelled', cancelled: true } };

  if (file.size <= RESUMABLE_FROM) {
    onProgress?.(5);
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType: type, cacheControl: '3600' });
    if (!error) onProgress?.(100);
    return { error: error ? { message: friendlyStorageError(error.message) } : null };
  }

  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { error: { message: 'Please sign in again to upload files.' } };

  return new Promise((resolve) => {
    const upload = new tus.Upload(file, {
      endpoint: resumableEndpoint(),
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: bucket, objectName: path, contentType: type, cacheControl: '3600' },
      chunkSize: CHUNK_SIZE,
      onError: (err) => resolve({ error: { message: friendlyStorageError(err?.message || String(err)) } }),
      onProgress: (sent, total) => onProgress?.(Math.min(99, Math.round((sent / total) * 100))),
      onSuccess: () => {
        onProgress?.(100);
        resolve({ error: null });
      },
    });
    signal?.addEventListener('abort', () => {
      upload.abort(true).finally(() => resolve({ error: { message: 'Upload cancelled', cancelled: true } }));
    });
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

function friendlyStorageError(message = '') {
  const m = message.toLowerCase();
  if (m.includes('exceeded the maximum allowed size') || m.includes('too large') || m.includes('413')) {
    return `That file is larger than the storage limit for this project (max ${MAX_ATTACHMENT_LABEL}).`;
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Upload failed - check your connection and try again.';
  }
  return message || 'Upload failed.';
}
