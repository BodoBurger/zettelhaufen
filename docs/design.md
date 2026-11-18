# Design plan

## Goal & objectives

Unsorted collection of interesting and inspirational stuff I find on the internet. Can be a story, an image, a video, a concept or something else.

Design principles of the system: simple, fast, low maintenance, low overhead, easily migratable and movable.


## First draft idea

- base data file is a README.md in the root of a git repository
    - posts are started with a headline using like this: `## This is the title of the post`
    - then, the user can write down some thoughts in markdown
    - the text block is followed by a bullet point list defining the meta data of a post
        - link: main link leading the 
        - date: `YYYY-MM-DD`; user defined date, used to sort the posts
        - date-source: `YYYY-MM-DD`; date of the source, like publication date of an article
        - tags: `Tag 1, Tag 2, Tag 3`; user can use tags to categorize each post; allows user to filter and search for posts; case-insensitive
        - lang: set language of post if it is not the default language
        - see-also: bulltet point list of links to related sources; same concept as in wikipedia
    - all data is optional except for title, link and date
    - there is a metadata block to set document wide settings like language
- the user just needs to edit the text file, commiting triggers the redeploy process
- result is a minimalist, but beautiful web page similar to blog
    - design language: minimalist, brutalist
- stack: Github repo, actions and pages

## Editing and publishing

Use `#` for the site title, `##` for each post title, and `###` or deeper for headings inside notes. Put the metadata bullets at the end of each post. For example:

```markdown
## An interesting article

Some **Markdown** notes about the article.

- link: https://example.com/article
- date: 2026-11-18
- date-source: 2026-11-15
- tags: Design, Photography
- lang: en
- see-also:
  - [Related article](https://example.com/related)
  - https://example.com/another
```

You can omit notes and any field other than `link` and `date`. Use an absolute HTTP(S) URL for the main link and a calendar date in `YYYY-MM-DD` format. The existing `see_also` spelling also works. Set the default document language with a fenced `metadata` block containing `lang: en`, as shown in the root README. A post can override the default with its own `lang` field. The site lists newest dates first and preserves README order for equal dates.

During the build, an image in the notes is shown in place and takes precedence over an automatic preview. A direct image link or the linked page's Open Graph image can supply a decorative thumbnail. Posts without an available image stay text-only.

YouTube video links use the video ID to load a thumbnail directly from YouTube, without a build-time lookup.

Builds reuse preview URLs for 30 days and cache pages with no preview for seven days. Each build attempts up to 20 lookups, with at most four running at once. New links go first, followed by the least recently attempted refreshes. Cached thumbnails stay visible while a refresh waits or if it fails. Failed lookups are eligible to retry on the next build. GitHub Actions restores and saves the lookup cache across deploys.

Build locally with Node.js 24, `npm ci`, and `npm run build`, then open `dist/index.html`. On GitHub, select **Settings → Pages → Build and deployment → Source → GitHub Actions** once. Pushing the files to the default branch runs the workflow and publishes the generated site. Subsequent pushes to that branch rebuild it from the README.
