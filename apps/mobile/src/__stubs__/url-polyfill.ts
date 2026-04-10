// URL polyfill for Hermes/React Native
// React Native's built-in URL.js throws for .protocol, .port, .search etc.
// This patches the global URL with a working implementation.

class FullURL {
  private _url: string;
  private _parsed: {
    protocol: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
    host: string;
    origin: string;
    href: string;
  };

  constructor(url: string, base?: string) {
    this._url = url;
    const match = url.match(/^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/);
    if (!match) throw new TypeError('Invalid URL: ' + url);
    const scheme = match[2] || '';
    const authority = match[4] || '';
    const path = match[5] || '';
    const query = match[7] !== undefined ? '?' + match[7] : '';
    const fragment = match[9] !== undefined ? '#' + match[9] : '';
    const hostParts = authority.split(':');
    this._parsed = {
      protocol: scheme ? scheme + ':' : '',
      hostname: hostParts[0] || '',
      port: hostParts[1] || '',
      pathname: path || '/',
      search: query,
      hash: fragment,
      host: authority,
      origin: scheme ? scheme + '://' + authority : '',
      href: url,
    };
  }

  get protocol() { return this._parsed.protocol; }
  get hostname() { return this._parsed.hostname; }
  get port() { return this._parsed.port; }
  get pathname() { return this._parsed.pathname; }
  get search() { return this._parsed.search; }
  get hash() { return this._parsed.hash; }
  get host() { return this._parsed.host; }
  get origin() { return this._parsed.origin; }
  get href() { return this._parsed.href; }
  toString() { return this._parsed.href; }
}

if (typeof global !== 'undefined') {
  (global as any).URL = FullURL;
}

export { FullURL as URL };
