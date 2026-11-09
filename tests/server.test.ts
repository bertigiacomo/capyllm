import { describe, it, expect } from 'bun:test';
import { app } from '../src/index';

describe('Server & Static Files', () => {
  it('serves healthcheck at /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.service).toBe('CapyLLM');
  });

  it('serves SPA index.html on root /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('CapyLLM');
    expect(html).toContain('<div id="root"></div>');
  });

  it('serves SPA index.html on client-side routes like /auth/setup', async () => {
    const res = await app.request('/auth/setup?token=123');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('CapyLLM');
  });
});
