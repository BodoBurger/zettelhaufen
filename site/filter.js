const filters = document.querySelector('#filters');
const search = document.querySelector('#search');
const tag = document.querySelector('#tag');
const results = document.querySelector('#results');
const sweep = document.querySelector('#sweep');
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
  const pileView = document.querySelector('#pile-view');
  const blogView = document.querySelector('#blog-view');
  const pile = document.querySelector('.pile');
  const pileControls = document.querySelector('#pile-controls');
  const back = document.querySelector('#back-to-pile');
  const flights = new Set();

  function reshuffle() {
    const rotation = Math.random() * 2 * Math.PI;
    const angleStep = Math.PI * (3 - Math.sqrt(5));
    for (const [index, paper] of [...pile.children].entries()) {
      const radius = Math.sqrt(index / Math.max(1, pile.children.length - 1)) * (.87 + .13 * Math.random());
      const angle = rotation + index * angleStep + (Math.random() - .5) * 1.6;
      paper.style.setProperty('--paper-x', `${50 + 50 * radius * Math.cos(angle)}%`);
      paper.style.setProperty('--paper-y', `${50 + 50 * radius * Math.sin(angle)}%`);
      paper.style.setProperty('--paper-tilt', `${(Math.random() - .5) * 48}deg`);
    }
  }
  reshuffle();
  pile.classList.add('laid-out');
  document.querySelector('#reshuffle').addEventListener('click', reshuffle);
  pileControls.hidden = false;
  back.addEventListener('click', () => {
    for (const flight of flights) flight.cancel();
    blogView.hidden = true;
    back.hidden = true;
    pileView.hidden = false;
    pileControls.hidden = false;
    sweep.focus();
  });
  search.addEventListener('input', filterPosts);
  tag.addEventListener('change', filterPosts);
  filters.hidden = false;
  filterPosts();
  sweep.addEventListener('click', () => {
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches && typeof sweep.animate === 'function';
    const papers = animate ? [...pile.children].flatMap((paper, index) => {
      const image = paper.querySelector('.thumbnail:not([hidden])');
      const start = (image || paper).getBoundingClientRect();
      if (start.bottom <= 0 || start.top >= innerHeight) return [];
      const article = posts[index].article;
      const destination = [...article.querySelectorAll('.thumbnail:not([hidden]), .notes img')]
        .find(candidate => image && candidate.src === image.src) || article.querySelector('h2 a');
      return [{ start, destination, image, source: image || paper.querySelector('span') }];
    }).reverse() : [];

    pileView.hidden = true;
    pileControls.hidden = true;
    blogView.hidden = false;
    back.hidden = false;
    search.focus({ preventScroll: true });

    for (const { start, destination, image, source } of papers) {
      const end = destination.getBoundingClientRect();
      if (!end.width || !end.height) continue;
      const flyer = source.cloneNode(true);
      flyer.className = image ? 'flying-thumbnail' : 'flying-note';
      flyer.setAttribute('aria-hidden', 'true');
      Object.assign(flyer.style, {
        left: `${start.left}px`, top: `${start.top}px`,
        width: `${start.width}px`, height: `${start.height}px`,
      });
      document.body.append(flyer);
      destination.classList.add('receiving-paper');
      const flight = flyer.animate([
        { transform: 'none' },
        { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px) scale(${end.width / start.width}, ${end.height / start.height})` },
      ], { duration: 850, easing: 'cubic-bezier(.22, .7, .25, 1)', fill: 'forwards' });
      flights.add(flight);
      const finish = () => {
        flights.delete(flight);
        flyer.remove();
        destination.classList.remove('receiving-paper');
      };
      flight.finished.then(finish, finish);
    }
  });
}
