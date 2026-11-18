const filters = document.querySelector('#filters');
const search = document.querySelector('#search');
const tag = document.querySelector('#tag');
const results = document.querySelector('#results');
const normalize = value => value.normalize('NFC').toLowerCase();

for (const thumbnail of document.querySelectorAll('.thumbnail')) {
  thumbnail.addEventListener('error', () => { thumbnail.hidden = true; });
  if (thumbnail.complete && !thumbnail.naturalWidth) thumbnail.hidden = true;
}

const posts = [...document.querySelector('#posts').children].map(article => ({
  article,
  text: normalize([...article.children].map(element => element.textContent).join(' ').replace(/\s+/g, ' ')),
  tags: new Set([...article.querySelectorAll('[data-tag]')].map(item => item.dataset.tag)),
}));

function filterPosts() {
  const query = normalize(search.value.trim()).split(/\s+/);
  let count = 0;
  for (const post of posts) {
    const matches = (!tag.value || post.tags.has(tag.value)) && query.every(word => post.text.includes(word));
    post.article.hidden = !matches;
    if (matches) count += 1;
  }
  results.textContent = count ? `${count} ${count === 1 ? 'post' : 'posts'}` : 'No matching posts.';
}

if (posts.length) {
  search.addEventListener('input', filterPosts);
  tag.addEventListener('change', filterPosts);
  filters.hidden = false;
  filterPosts();
}
