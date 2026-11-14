import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeExternalUrl, normalizeUrl, openExternalUrl } from '../url';

describe('url utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for blank input or control characters', () => {
    expect(normalizeExternalUrl('')).toBe('');
    expect(normalizeExternalUrl('   ')).toBe('');
    expect(normalizeExternalUrl('java\nscript:alert(1)')).toBe('');
    expect(normalizeExternalUrl('https://example.com\x00/foo')).toBe('');
    expect(normalizeExternalUrl('https://example.com\x7f')).toBe('');
  });

  it('blocks dangerous protocols (javascript, data, vbscript, file, ftp)', () => {
    expect(normalizeExternalUrl('javascript:alert(1)')).toBe('');
    expect(normalizeExternalUrl('JaVaScRiPt:alert(document.cookie)')).toBe('');
    expect(normalizeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(normalizeExternalUrl('vbscript:msgbox(1)')).toBe('');
    expect(normalizeExternalUrl('file:///etc/passwd')).toBe('');
    expect(normalizeExternalUrl('ftp://files.example.com/a')).toBe('');
  });

  it('normalizes valid http, https, protocol-relative, and bare hostnames', () => {
    expect(normalizeExternalUrl('example.com')).toBe('https://example.com/');
    expect(normalizeExternalUrl('//intranet.corp/app')).toBe('https://intranet.corp/app');
    expect(normalizeExternalUrl('http://10.0.0.5:8080/health')).toBe('http://10.0.0.5:8080/health');
    expect(normalizeExternalUrl('  https://portal.corp/path?a=1#top  ')).toBe(
      'https://portal.corp/path?a=1#top',
    );
    expect(normalizeUrl).toBe(normalizeExternalUrl);
  });

  it('rejects malformed URLs without a hostname', () => {
    expect(normalizeExternalUrl('https://')).toBe('');
    expect(normalizeExternalUrl('http://[::1')).toBe('');
  });

  it('openExternalUrl opens safe URLs with noopener,noreferrer and ignores unsafe ones', () => {
    const spy = vi.spyOn(window, 'open').mockImplementation(() => null);
    openExternalUrl('javascript:alert(1)');
    expect(spy).not.toHaveBeenCalled();

    openExternalUrl('grafana.internal/d/1');
    expect(spy).toHaveBeenCalledWith(
      'https://grafana.internal/d/1',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
