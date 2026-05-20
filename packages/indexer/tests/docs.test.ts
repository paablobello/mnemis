import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { buildDocsSiteIndex, crawlDocsSite } from '../src/index.ts';

const originalFetch = globalThis.fetch;
const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
const originalFirecrawlUrl = process.env.FIRECRAWL_API_URL;

function html(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'last-modified': 'Tue, 19 May 2026 10:00:00 GMT',
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) {
    Reflect.deleteProperty(process.env, 'FIRECRAWL_API_KEY');
  } else {
    process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
  if (originalFirecrawlUrl === undefined) {
    Reflect.deleteProperty(process.env, 'FIRECRAWL_API_URL');
  } else {
    process.env.FIRECRAWL_API_URL = originalFirecrawlUrl;
  }
});

describe('docs crawler', () => {
  it('crawls same-origin HTML, sitemap URLs and converts pages to markdown files', async () => {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href === 'https://docs.example.com/robots.txt') {
        return response('User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml', {
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (href === 'https://docs.example.com/sitemap.xml') {
        return response('<urlset><url><loc>https://docs.example.com/guide</loc></url></urlset>', {
          headers: { 'content-type': 'application/xml' },
        });
      }
      if (href === 'https://docs.example.com/') {
        return response(
          html(
            'Home',
            [
              '<h1>Home</h1>',
              '<p>Welcome to Mnemis docs.</p>',
              '<a href="/api">API</a>',
              '<a href="/private/secret">Private</a>',
              '<a href="https://external.example.com/x">External</a>',
            ].join(''),
          ),
        );
      }
      if (href === 'https://docs.example.com/guide') {
        return response(html('Guide', '<h1>Guide</h1><h2>Install</h2><p>Run the wizard.</p>'));
      }
      if (href === 'https://docs.example.com/api') {
        return response(html('API', '<h1>API</h1><p>Use raw search with citations.</p>'));
      }
      if (href === 'https://docs.example.com/private/secret') {
        throw new Error('private URL should be blocked by robots');
      }
      return new Response('missing', { status: 404 });
    };

    const files = await crawlDocsSite('https://docs.example.com/', { maxPages: 10 });
    assert.deepEqual(files.map((file) => file.path).sort(), ['api.md', 'guide.md', 'index.md']);
    assert.ok(files.every((file) => file.language === 'markdown'));
    assert.ok(files.find((file) => file.path === 'guide.md')?.content.includes('## Install'));
  });

  it('honors include and exclude path filters for docs URLs', async () => {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (href.endsWith('/sitemap.xml')) {
        return response(
          [
            '<urlset>',
            '<url><loc>https://docs.example.com/guide</loc></url>',
            '<url><loc>https://docs.example.com/api</loc></url>',
            '</urlset>',
          ].join(''),
          { headers: { 'content-type': 'application/xml' } },
        );
      }
      if (href === 'https://docs.example.com/guide') {
        return response(html('Guide', '<h1>Guide</h1><p>Keep this page.</p>'));
      }
      if (href === 'https://docs.example.com/api') {
        return response(html('API', '<h1>API</h1><p>Drop this page.</p>'));
      }
      return response(html('Home', '<h1>Home</h1>'));
    };

    const files = await crawlDocsSite('https://docs.example.com/', {
      includePaths: ['guide', 'api'],
      excludePaths: ['api'],
      maxPages: 10,
    });

    assert.deepEqual(
      files.map((file) => file.path),
      ['guide.md'],
    );
  });

  it('fails when robots disallows the start URL', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/robots.txt')) {
        return response('User-agent: *\nDisallow: /', {
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response('blocked', { status: 500 });
    };

    await assert.rejects(() => crawlDocsSite('https://docs.example.com/'), /robots\.txt disallows/);
  });

  it('builds chunks and fails empty crawls clearly', async () => {
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/robots.txt') || href.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 });
      }
      if (href === 'https://docs.example.com/') {
        return response(html('Home', '<h1>Home</h1><h2>Search</h2><p>Hybrid retrieval.</p>'));
      }
      return new Response('', { status: 404 });
    };

    const index = await buildDocsSiteIndex('https://docs.example.com/');
    assert.equal(index.files.length, 1);
    assert.equal(index.chunks.length, 2);
    assert.equal(index.chunks[0]!.path, 'index.md');

    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(
      () => buildDocsSiteIndex('https://empty.example.com/'),
      /no indexable pages/,
    );
  });

  it('uses Firecrawl when configured and converts crawl results to markdown files', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test';
    process.env.FIRECRAWL_API_URL = 'https://firecrawl.test/v2';
    const calls: Array<{ url: string; body: unknown }> = [];

    globalThis.fetch = async (url, init) => {
      const href = String(url);
      calls.push({
        url: href,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      if (href === 'https://firecrawl.test/v2/crawl') {
        return new Response(
          JSON.stringify({ success: true, id: 'crawl-1', url: 'https://docs.example.com/' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (href === 'https://firecrawl.test/v2/crawl/crawl-1') {
        return new Response(
          JSON.stringify({
            status: 'completed',
            data: [
              {
                markdown: '# Guide\n\nRendered by Firecrawl.',
                metadata: { sourceURL: 'https://docs.example.com/guide', title: 'Guide' },
              },
              {
                markdown: '# API\n\nExcluded.',
                metadata: { sourceURL: 'https://docs.example.com/api', title: 'API' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('missing', { status: 404 });
    };

    const files = await crawlDocsSite('https://docs.example.com/', {
      docsCrawler: 'firecrawl',
      includePaths: ['guide', 'api'],
      excludePaths: ['api'],
      maxPages: 5,
    });

    assert.deepEqual(
      files.map((file) => file.path),
      ['guide.md'],
    );
    assert.equal(files[0]!.content, '# Guide\n\nRendered by Firecrawl.');
    assert.equal(calls[0]!.url, 'https://firecrawl.test/v2/crawl');
    assert.equal((calls[0]!.body as { limit: number }).limit, 5);
  });

  it('falls back to the native crawler in auto mode when Firecrawl is not configured', async () => {
    Reflect.deleteProperty(process.env, 'FIRECRAWL_API_KEY');
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/robots.txt') || href.endsWith('/sitemap.xml')) {
        return new Response('', { status: 404 });
      }
      return response(html('Home', '<h1>Home</h1><p>Native fallback.</p>'));
    };

    const files = await crawlDocsSite('https://docs.example.com/', { docsCrawler: 'auto' });
    assert.equal(files[0]!.path, 'index.md');
    assert.match(files[0]!.content, /Native fallback/);
  });

  it('fails clearly when Firecrawl is forced but not configured', async () => {
    Reflect.deleteProperty(process.env, 'FIRECRAWL_API_KEY');
    await assert.rejects(
      () => crawlDocsSite('https://docs.example.com/', { docsCrawler: 'firecrawl' }),
      /firecrawl_not_configured/,
    );
  });
});
