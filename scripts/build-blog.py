#!/usr/bin/env python3
"""Build the Gramps Connect blog (served on GitHub Pages at /blog/).

Posts are Markdown files in blog/posts/, named YYYY-MM-DD-slug.md, each
starting with a small header:

    ---
    title: Welcome to the blog
    summary: One sentence shown on the blog's front page and in the feed.
    author: Doug Blank
    ---

    The post itself, in Markdown. Put images in blog/img/ and use them as

        ![What the picture shows](img/name.jpg)
        *An optional caption, in italics on the line right after.*

    Keep screenshots around 1500 px wide, saved as JPEG.

    The post's first image is also its thumbnail: shown beside it on the
    blog's front page, named in the feed (media:thumbnail) and used as the
    preview picture when someone shares a link to the post (og:image). To
    pick a different one, add "thumbnail: img/other.jpg" to the header;
    "thumbnail: none" leaves the post without one.

Running

    python scripts/build-blog.py

writes blog/index.html, one blog/<slug>.html per post, and blog/feed.xml
(an Atom feed). blog/feed.xsl is hand-written, not generated: it makes
feed.xml readable when opened in a browser. Commit the .md and the generated files together; GitHub
Pages serves them as they are, with no build step of its own. A post whose
header has "draft: true" is skipped.

Needs the "markdown" package (pip install markdown).
"""

import datetime
import html
import pathlib
import re
import sys
import urllib.parse

import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLOG = ROOT / "blog"
POSTS = BLOG / "posts"
SITE = "https://dsblank.github.io/gramps-connect/"
BLOG_URL = SITE + "blog/"

FIRST_IMG_RE = re.compile(r'<img [^>]*?src="([^"]+)"')

NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$")


# A paragraph holding just an image, optionally followed by an italic line,
# becomes a <figure> with that line as its caption.
FIGURE_RE = re.compile(r"<p>(<img [^>]*>)\s*(?:<em>(.*?)</em>)?</p>", re.S)


def figure(m):
    caption = f"<figcaption>{m.group(2)}</figcaption>" if m.group(2) else ""
    return f"<figure>{m.group(1)}{caption}</figure>"


def read_post(path):
    m = NAME_RE.match(path.name)
    if not m:
        sys.exit(f"{path.name}: post files must be named YYYY-MM-DD-slug.md")
    date, slug = m.groups()
    text = path.read_text(encoding="utf-8")
    meta = {}
    if text.startswith("---\n"):
        header, _, text = text[4:].partition("\n---\n")
        for line in header.splitlines():
            if ":" in line:
                key, _, value = line.partition(":")
                meta[key.strip().lower()] = value.strip()
    if "title" not in meta:
        sys.exit(f"{path.name}: missing 'title:' in the header")
    body = markdown.markdown(text, extensions=["extra", "sane_lists", "smarty"])
    body = FIGURE_RE.sub(figure, body)
    thumbnail = meta.get("thumbnail", "")
    if thumbnail.lower() == "none":
        thumbnail = ""
    elif not thumbnail:
        m = FIRST_IMG_RE.search(body)
        thumbnail = html.unescape(m.group(1)) if m else ""
    return {
        "date": date,
        "slug": slug,
        "title": meta["title"],
        "summary": meta.get("summary", ""),
        "author": meta.get("author", ""),
        "draft": meta.get("draft", "").lower() in ("true", "yes", "1"),
        "html": body,
        # As written in the post (img/x.jpg); see thumbnail_url() for the
        # full address that feeds and link previews need.
        "thumbnail": thumbnail,
    }


def nice_date(date):
    d = datetime.date.fromisoformat(date)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


STYLE = """
  :root {
    --bg: #ffffff; --bg-alt: #f5f6f8; --fg: #1f2328; --muted: #59636e;
    --border: #d8dee4; --accent: #2f6f4f; --accent-fg: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16191d; --bg-alt: #1e2228; --fg: #e6e8eb; --muted: #9aa4af;
      --border: #333a42; --accent: #5fb38a; --accent-fg: #0d1a13;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: var(--accent); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 16px; }
  nav { display: flex; align-items: center; gap: 16px; padding: 20px 0;
        border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  nav .home { display: flex; align-items: center; gap: 8px; font-weight: 700;
              color: var(--fg); text-decoration: none; margin-right: auto; }
  nav .home img { width: 28px; height: 28px; }
  nav a { text-decoration: none; }
  h1 { font-size: 2rem; line-height: 1.25; margin: 40px 0 8px; }
  .meta { color: var(--muted); font-size: 0.95rem; margin: 0 0 32px; }
  .post-list { list-style: none; padding: 0; margin: 0 0 48px; }
  .post-list li { padding: 24px 0; border-bottom: 1px solid var(--border);
                  display: flex; gap: 20px; align-items: flex-start; }
  .post-list .text { flex: 1; min-width: 0; }
  .post-list .thumb { flex: none; width: 168px; aspect-ratio: 4 / 3;
                      border: 1px solid var(--border); border-radius: 8px;
                      overflow: hidden; background: var(--bg-alt); }
  .post-list .thumb img { display: block; width: 100%; height: 100%;
                          object-fit: cover; object-position: top left; }
  @media (max-width: 560px) {
    .post-list li { flex-direction: column-reverse; gap: 12px; }
    .post-list .thumb { width: 100%; aspect-ratio: 2 / 1; }
  }
  .post-list h2 { font-size: 1.35rem; margin: 0 0 4px; }
  .post-list h2 a { color: var(--fg); text-decoration: none; }
  .post-list h2 a:hover { color: var(--accent); }
  .post-list p { margin: 6px 0 0; }
  .post-list .meta { margin: 0; }
  article { margin-bottom: 48px; }
  article h2 { font-size: 1.4rem; margin: 36px 0 8px; }
  article h3 { font-size: 1.15rem; margin: 28px 0 8px; }
  article img { max-width: 100%; height: auto; border: 1px solid var(--border);
                border-radius: 8px; }
  article figure { margin: 24px 0; }
  article figure img { display: block; }
  article figcaption { margin-top: 6px; color: var(--muted); font-size: 0.92rem;
                       text-align: center; }
  article pre { background: var(--bg-alt); border: 1px solid var(--border);
                border-radius: 6px; padding: 12px 16px; overflow-x: auto; }
  article code { font-size: 0.92em; }
  article blockquote { margin: 16px 0; padding: 0 16px; color: var(--muted);
                       border-left: 3px solid var(--border); }
  .back { margin: 0 0 48px; }
  footer { padding: 32px 0 48px; border-top: 1px solid var(--border);
           color: var(--muted); font-size: 0.9rem; text-align: center; }
"""


def social_tags(title, description, url, image, kind):
    """Open Graph tags: the title, text and picture that Discourse, Mastodon,
    Slack, Facebook and others show when someone pastes a link."""
    tags = [
        ("og:site_name", "Gramps Connect"),
        ("og:type", kind),
        ("og:title", title),
        ("og:description", description),
        ("og:url", url),
    ]
    if image:
        tags.append(("og:image", image))
    lines = [f'<meta property="{k}" content="{html.escape(v)}">' for k, v in tags]
    card = "summary_large_image" if image else "summary"
    lines.append(f'<meta name="twitter:card" content="{card}">')
    lines.append(f'<link rel="canonical" href="{html.escape(url)}">')
    return "\n".join(lines)


def page(title, description, body, social):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
{social}
<link rel="icon" href="../app/public/favicon-32.png">
<link rel="alternate" type="application/atom+xml" title="Gramps Connect blog" href="feed.xml">
<style>{STYLE}</style>
</head>
<body>
<div class="wrap">
<nav>
  <a class="home" href="../"><img src="../app/src/assets/icons/gramps-connect-logo.svg" alt="">Gramps Connect</a>
  <a href="./">Blog</a>
  <a href="../tour/">Tour</a>
  <a href="https://github.com/dsblank/gramps-connect/wiki">Documentation</a>
  <a href="feed.xml">Feed</a>
</nav>
{body}
<footer>
  <!-- Generated by scripts/build-blog.py from blog/posts/; edit the .md, not this file. -->
  Gramps Connect is free software under the AGPL-3.0-or-later licence.
</footer>
</div>
</body>
</html>
"""


def byline(post):
    parts = [f'<time datetime="{post["date"]}">{nice_date(post["date"])}</time>']
    if post["author"]:
        parts.append(html.escape(post["author"]))
    return " · ".join(parts)


def post_url(post):
    return f"{BLOG_URL}{post['slug']}.html"


def thumbnail_url(post):
    """The thumbnail's full address, or "" when the post has none."""
    if not post["thumbnail"]:
        return ""
    return urllib.parse.urljoin(post_url(post), post["thumbnail"])


def build_index(posts):
    items = []
    for p in posts:
        summary = f"<p>{html.escape(p['summary'])}</p>" if p["summary"] else ""
        # The title link already names the post, so the picture is a second
        # way in rather than more to read: empty alt, out of the tab order.
        thumb = (
            f'<a class="thumb" href="{p["slug"]}.html" tabindex="-1" aria-hidden="true">'
            f'<img src="{html.escape(p["thumbnail"])}" alt="" loading="lazy"></a>'
            if p["thumbnail"] else ""
        )
        items.append(
            f'<li><div class="text"><h2><a href="{p["slug"]}.html">{html.escape(p["title"])}</a></h2>'
            f'<p class="meta">{byline(p)}</p>{summary}</div>{thumb}</li>'
        )
    body = (
        "<h1>Blog</h1>\n"
        '<p class="meta">News, new features and behind-the-scenes notes on Gramps Connect.</p>\n'
        f'<ul class="post-list">\n{chr(10).join(items) or "<li>No posts yet.</li>"}\n</ul>'
    )
    description = "News and notes from the Gramps Connect project."
    image = thumbnail_url(posts[0]) if posts else ""
    return page(
        "Gramps Connect blog", description, body,
        social_tags("Gramps Connect blog", description, BLOG_URL, image, "website"),
    )


def build_post(post):
    body = (
        f"<article>\n<h1>{html.escape(post['title'])}</h1>\n"
        f'<p class="meta">{byline(post)}</p>\n{post["html"]}\n</article>\n'
        '<p class="back"><a href="./">&larr; All posts</a></p>'
    )
    description = post["summary"] or post["title"]
    return page(
        f"{post['title']} · Gramps Connect", description, body,
        social_tags(post["title"], description, post_url(post), thumbnail_url(post), "article"),
    )


RELATIVE_URL_RE = re.compile(r'(\b(?:src|href)=")([^"#][^"]*)(")')


def absolute_urls(body, base):
    """Feed readers show a post away from the site, so its relative links
    and images (img/x.jpg, ../tour/) must become full addresses."""
    def fix(m):
        url = m.group(2)
        if re.match(r"^[a-z][a-z0-9+.-]*:", url) or url.startswith("/"):
            return m.group(0)
        return m.group(1) + urllib.parse.urljoin(base, url) + m.group(3)
    return RELATIVE_URL_RE.sub(fix, body)


def build_feed(posts):
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    updated = f"{posts[0]['date']}T00:00:00Z" if posts else now
    entries = []
    for p in posts:
        url = post_url(p)
        author = f"<author><name>{html.escape(p['author'])}</name></author>" if p["author"] else ""
        # Media RSS's thumbnail, the element feed readers look for when a
        # feed names an entry's picture outright.
        thumb = (
            f'<media:thumbnail url="{html.escape(thumbnail_url(p))}"/>'
            if p["thumbnail"] else ""
        )
        entries.append(
            f"""  <entry>
    <title>{html.escape(p['title'])}</title>
    <link href="{url}"/>
    <id>{url}</id>
    <updated>{p['date']}T00:00:00Z</updated>
    {author}
    {thumb}
    <summary>{html.escape(p['summary'])}</summary>
    <content type="html">{html.escape(absolute_urls(p['html'], url))}</content>
  </entry>"""
        )
    return f"""<?xml version="1.0" encoding="utf-8"?>
<?xml-stylesheet type="text/xsl" href="feed.xsl"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Gramps Connect blog</title>
  <link href="{BLOG_URL}"/>
  <link rel="self" href="{BLOG_URL}feed.xml"/>
  <id>{BLOG_URL}</id>
  <updated>{updated}</updated>
  <author><name>Gramps Connect</name></author>
{chr(10).join(entries)}
</feed>
"""


def main():
    posts = [read_post(p) for p in sorted(POSTS.glob("*.md"))]
    posts = [p for p in posts if not p["draft"]]
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)

    wanted = {f"{p['slug']}.html" for p in posts}
    for old in BLOG.glob("*.html"):
        if old.name != "index.html" and old.name not in wanted:
            old.unlink()
            print(f"removed {old.relative_to(ROOT)}")

    (BLOG / "index.html").write_text(build_index(posts), encoding="utf-8")
    for p in posts:
        (BLOG / f"{p['slug']}.html").write_text(build_post(p), encoding="utf-8")
    (BLOG / "feed.xml").write_text(build_feed(posts), encoding="utf-8")
    print(f"built {len(posts)} post(s) into {BLOG.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
