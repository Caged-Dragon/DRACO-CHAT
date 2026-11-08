import { describe, it, expect } from 'vitest';
import { safeFileName, formatBytes, resumableEndpoint, MAX_ATTACHMENT_BYTES } from './upload.js';
import { friendlyAuthError } from './authErrors.js';
import { parseVoiceSeconds } from '../components/VoicePlayer.jsx';
import { extensionForMime, formatClock } from '../hooks/useVoiceRecorder.js';

describe('attachments', () => {
  it('allows files up to 100MB', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(100 * 1024 * 1024);
  });
  it('makes storage-safe file names and keeps the extension', () => {
    expect(safeFileName('My Holiday Photo (1).JPG')).toBe('My_Holiday_Photo_1.JPG');
    expect(safeFileName('résumé final.pdf')).toBe('resume_final.pdf');
    expect(safeFileName('日本語.zip')).toBe('file.zip');
    expect(safeFileName('noextension')).toBe('noextension');
  });
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
  });
  it('uses the dedicated storage host for resumable uploads', () => {
    expect(resumableEndpoint('https://abc123.supabase.co')).toBe('https://abc123.storage.supabase.co/storage/v1/upload/resumable');
    expect(resumableEndpoint('https://chat.example.com/')).toBe('https://chat.example.com/storage/v1/upload/resumable');
  });
});

describe('voice messages', () => {
  it('reads the length from the saved name', () => {
    expect(parseVoiceSeconds('Voice message (12s)')).toBe(12);
    expect(parseVoiceSeconds('Voice message')).toBe(0);
  });
  it('picks the right extension and clock format', () => {
    expect(extensionForMime('audio/mp4')).toBe('m4a');
    expect(extensionForMime('audio/webm')).toBe('webm');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('friendlyAuthError', () => {
  it('explains the email rate limit in plain words', () => {
    expect(friendlyAuthError({ message: 'email rate limit exceeded' })).toMatch(/can't send another email/);
  });
  it('passes lockout messages through unchanged', () => {
    const msg = 'Too many wrong passwords. This account is locked for 15 minutes.';
    expect(friendlyAuthError({ message: msg })).toBe(msg);
  });
});
