import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt();
const escape = md.utils.escapeHtml;
const normalize = value => value.normalize('NFC').toLowerCase();
const fields = /^(?:[-+*])\s+(link|date|date-source|tags|lang|see-also|see_also):\s*(.*)$/;

function language(value) {
  return Intl.getCanonicalLocales(value)[0];
}

function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('Expected a YYYY-MM-DD date');
  if (new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`Invalid date ${value}`);
  return value;
}

function httpUrl(value, base) {
  if (!value) throw new Error('Missing link URL');
  const parsed = new URL(value, base);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Expected an HTTP(S) link');
  return parsed.href;
}

function directThumbnail(link) {
  const { hostname, pathname, searchParams } = new URL(link);
  if (/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(pathname)) return link;

  let videoId;
  if (hostname === 'youtu.be') {
    videoId = pathname.match(/^\/([^/]+)\/?$/)?.[1];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)) {
    videoId = pathname === '/watch'
      ? searchParams.get('v')
      : pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
  }
  return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)
    ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'
    : '';
}

function relatedLink(value) {
  const tokens = md.parseInline(value, {})[0].children;
  if (tokens[0]?.type === 'link_open' && tokens.findIndex(token => token.type === 'link_close') === tokens.length - 1) {
    httpUrl(tokens[0].attrGet('href'));
    return md.renderer.renderInline(tokens, md.options, {});
  }
  return `<a href="${escape(httpUrl(value))}">${escape(value)}</a>`;
}

async function lookupThumbnail(link) {
  try {
    const response = await fetch(link, { signal: AbortSignal.timeout(2500) });
    const reader = response.body?.getReader();
    try {
      if (response.status === 404 || response.status === 410) return '';
      if (!response.ok) return null;
      if (!reader || !response.headers.get('content-type')?.includes('text/html')) return '';
      const decoder = new TextDecoder();
      let head = '';
      while (head.length < 128_000 && !/<\/head\s*>/i.test(head)) {
        const { done, value } = await reader.read();
        if (done) break;
        head += decoder.decode(value, { stream: true });
      }
      for (const meta of head.split(/<\/head\s*>/i, 1)[0].matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
        const attrs = new Map([...meta[0].matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
          .map(([, key, double, single, bare]) => [key.toLowerCase(), double ?? single ?? bare]));
        if (attrs.get('property')?.toLowerCase() === 'og:image' && attrs.get('content')?.trim()) {
          return httpUrl(md.utils.unescapeAll(attrs.get('content').trim()), response.url);
        }
      }
    } finally {
      await reader?.cancel().catch(() => {});
    }
  } catch {
    return null;
  }
  return '';
}

function parsePost(lines, heading, end, blocks, defaultLang) {
  if (!heading.title.trim()) throw new Error('Missing post title');
  const start = heading.map[1];
  const last = blocks.filter(token => token.map[0] >= start && token.map[1] <= end).at(-1);
  const metadata = {};
  const related = [];
  let bodyEnd = end;

  if (last?.type === 'bullet_list_open') {
    const list = lines.slice(...last.map);
    const firstField = list.findIndex(line => fields.test(line));
    if (firstField !== -1) {
      bodyEnd = last.map[0] + firstField;
      let key;
      for (const line of list.slice(firstField)) {
        if (!line.trim()) continue;
        const field = line.match(fields);
        if (field) {
          key = field[1].replace('_', '-');
          if (Object.hasOwn(metadata, key)) throw new Error(`Duplicate field ${key}`);
          metadata[key] = field[2].trim();
        } else {
          const nested = line.match(/^ {2,}[-+*]\s+(.+)$/);
          if (key !== 'see-also' || !nested) throw new Error(`Invalid metadata line ${line}`);
          related.push(relatedLink(nested[1].trim()));
        }
      }
      if (metadata['see-also']) throw new Error('Use indented bullets for see-also links');
    }
  }

  const body = lines.slice(start, bodyEnd).join('\n');
  const environment = {};
  const bodyTokens = md.parse(body, environment);
  const noteImage = bodyTokens.flatMap(token => token.children ?? [])
    .find(token => token.type === 'image')?.attrGet('src');
  const tags = new Map();
  for (const tag of (metadata.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean)) {
    if (!tags.has(normalize(tag))) tags.set(normalize(tag), tag);
  }
  const link = httpUrl(metadata.link);
  return {
    title: heading.title,
    link,
    date: date(metadata.date),
    sourceDate: metadata['date-source'] ? date(metadata['date-source']) : '',
    lang: metadata.lang ? language(metadata.lang) : defaultLang,
    noteImage,
    directThumbnail: noteImage ? '' : directThumbnail(link),
    tags,
    body: md.renderer.render(bodyTokens, md.options, environment),
    related,
  };
}

const source = (await readFile('README.md', 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const lines = source.split('\n');
const tokens = md.parse(source, {});
const blocks = tokens.filter(token => token.level === 0 && token.map);
const settings = blocks.filter(token => token.type === 'fence' && token.info.trim() === 'metadata');
if (settings.length > 1) throw new Error('Use one document metadata block');
let lang = 'en';
if (settings.length) {
  const setting = settings[0].content.trim().match(/^lang:[ \t]*(\S+)$/);
  if (!setting) throw new Error('Expected lang in the document metadata block');
  lang = language(setting[1]);
  lines.fill('', ...settings[0].map);
}

const headings = tokens.flatMap((token, index) =>
  token.type === 'heading_open' && token.level === 0 && token.markup.startsWith('#')
    ? [{ tag: token.tag, map: token.map, title: tokens[index + 1].content }]
    : []);
const title = headings.find(heading => heading.tag === 'h1')?.title || 'Zettelhaufen';
const sections = headings.filter(heading => heading.tag === 'h2');
const postBlocks = blocks.filter(token => !settings.includes(token));
const posts = sections.map((heading, index) => {
  try {
    return parsePost(lines, heading, sections[index + 1]?.map[0] ?? lines.length, postBlocks, lang);
  } catch (error) {
    throw new Error(`README.md:${heading.map[0] + 1} (${heading.title}): ${error.message}`, { cause: error });
  }
}).sort((a, b) => b.date.localeCompare(a.date));

const allTags = new Map();
for (const { tags } of posts) {
  for (const [key, tag] of tags) if (!allTags.has(key)) allTags.set(key, tag);
}
const tagOptions = [...allTags].sort(([a], [b]) => a.localeCompare(b, lang)).map(([key, label]) =>
  `<option value="${escape(key)}">${escape(label)}</option>`).join('');

const cachePath = '.thumbnail-cache/lookups.json';
let previousLookups = new Map();
try {
  previousLookups = new Map(JSON.parse(await readFile(cachePath, 'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT') console.warn(`Ignoring thumbnail cache: ${error.message}`);
}
const lookups = new Map();
const pending = [];
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
for (const post of posts) {
  if (post.noteImage || post.directThumbnail || lookups.has(post.link)) continue;
  const cached = previousLookups.get(post.link);
  lookups.set(post.link, cached);
  const ttl = (cached?.thumbnail ? 30 : 7) * day;
  if (!cached || cached.retry || now - cached.checkedAt >= ttl) {
    pending.push({ link: post.link, cached });
  }
}

// New links come first, then the least recently attempted refreshes.
pending.sort((a, b) => (a.cached?.checkedAt ?? 0) - (b.cached?.checkedAt ?? 0));
const queue = pending.slice(0, 20).values();
await Promise.all(Array.from({ length: 4 }, async () => {
  for (const { link, cached } of queue) {
    const thumbnail = await lookupThumbnail(link);
    lookups.set(link, thumbnail === null
      ? { thumbnail: cached?.thumbnail ?? '', checkedAt: now, retry: true }
      : { thumbnail, checkedAt: now });
  }
}));

await mkdir('.thumbnail-cache', { recursive: true });
await writeFile(cachePath, JSON.stringify([...lookups].filter(([, entry]) => entry)));
const thumbnails = posts.map(post => post.noteImage ? '' : post.directThumbnail || lookups.get(post.link)?.thumbnail);
const pilePosts = posts.slice(0, 50);
const papers = pilePosts.map((post, index) => {
  const thumbnail = post.noteImage || thumbnails[index];
  return `
      <a class="paper" style="--paper-layer: ${-index}" href="${escape(post.link)}" lang="${escape(post.lang)}"${thumbnail ? ` aria-label="${escape(post.title)}"` : ''}>
        <span>${escape(post.title)}</span>
        ${thumbnail ? `<img class="thumbnail" src="${escape(thumbnail)}" alt="" decoding="async">` : ''}
      </a>`;
}).join('');
const articles = posts.map((post, index) => `
    <article lang="${escape(post.lang)}">
      <div class="dates"><time datetime="${post.date}">${post.date}</time>${post.sourceDate ? `
        <span lang="en">Source date <time datetime="${post.sourceDate}">${post.sourceDate}</time></span>` : ''}</div>
      <h2><a href="${escape(post.link)}">${escape(post.title)}</a></h2>
      ${thumbnails[index] ? `<img class="thumbnail" src="${escape(thumbnails[index])}" alt="" loading="lazy" decoding="async">` : ''}
      ${post.body ? `<div class="notes">${post.body}</div>` : ''}
      ${post.tags.size ? `<ul class="tags">${[...post.tags].map(([key, tag]) =>
        `<li data-tag="${escape(key)}">${escape(tag)}</li>`).join('')}</ul>` : ''}
      ${post.related.length ? `<h3 lang="en">See also</h3><ul>${post.related.map(link => `<li>${link}</li>`).join('')}</ul>` : ''}
    </article>`).join('');

await mkdir('dist', { recursive: true });
await cp('site', 'dist', { recursive: true });
await writeFile('dist/index.html', `<!doctype html>
<html lang="${escape(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <link rel="stylesheet" href="./style.css">
  <script src="./filter.js" defer></script>
  ${posts.length ? '<noscript><style>#pile-view { display: none; } #blog-view[hidden] { display: block !important; }</style></noscript>' : ''}
</head>
<body>
  <main>
    <header><h1>${escape(title)}</h1></header>
    ${posts.length ? `<section id="pile-view" aria-label="Pile of posts">
      <button id="sweep" type="button" aria-controls="blog-view" hidden><span aria-hidden="true">🧹</span> Sort the pile</button>
      <div class="pile" style="--paper-count: ${pilePosts.length}">${papers}
      </div>
    </section>` : ''}
    <section id="blog-view"${posts.length ? ' hidden' : ''}>
      <div id="filters" lang="en" hidden>
        <label>Search <input id="search" type="search"></label>
        <label>Tag <select id="tag"><option value="">All tags</option>${tagOptions}</select></label>
      </div>
      <p id="results" role="status" lang="en">${posts.length ? '' : 'No posts yet.'}</p>
      <div id="posts">${articles}
      </div>
    </section>
  </main>
</body>
</html>
`);
