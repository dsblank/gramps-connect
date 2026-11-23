<?xml version="1.0" encoding="utf-8"?>
<!--
  Shows blog/feed.xml as a readable page when someone opens it in a
  browser. Feed readers ignore this file. Linked from feed.xml by
  scripts/build-blog.py.
-->
<xsl:stylesheet version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:atom="http://www.w3.org/2005/Atom"
    xmlns:media="http://search.yahoo.com/mrss/">
<xsl:output method="html" encoding="utf-8" doctype-system="about:legacy-compat"/>

<xsl:template match="/atom:feed">
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title><xsl:value-of select="atom:title"/> (feed)</title>
<link rel="icon" href="../app/public/favicon-32.png"/>
<style>
  :root {
    --bg: #ffffff; --bg-alt: #f5f6f8; --fg: #1f2328; --muted: #59636e;
    --border: #d8dee4; --accent: #2f6f4f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16191d; --bg-alt: #1e2228; --fg: #e6e8eb; --muted: #9aa4af;
      --border: #333a42; --accent: #5fb38a;
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
  .about { background: var(--bg-alt); border: 1px solid var(--border);
           border-radius: 8px; padding: 16px 20px; margin: 16px 0 24px; }
  .about p { margin: 0 0 8px; }
  .about p:last-child { margin: 0; }
  .url { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         font-size: 0.92rem; background: var(--bg); border: 1px solid var(--border);
         border-radius: 6px; padding: 8px 12px; overflow-wrap: anywhere;
         user-select: all; }
  .meta { color: var(--muted); font-size: 0.95rem; margin: 0; }
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
</style>
</head>
<body>
<div class="wrap">
<nav>
  <a class="home" href="../"><img src="../app/src/assets/icons/gramps-connect-logo.svg" alt=""/>Gramps Connect</a>
  <a href="./">Blog</a>
  <a href="../tour/">Tour</a>
  <a href="https://github.com/dsblank/gramps-connect/wiki">Documentation</a>
</nav>

<h1>Subscribe to the blog</h1>
<div class="about">
  <p>This is the blog's <strong>feed</strong>. Copy the address below into
    a feed reader (such as Feedly, NetNewsWire, Inoreader or Thunderbird)
    and new posts will show up there automatically.</p>
  <span class="url"><xsl:value-of select="atom:link[@rel='self']/@href"/></span>
  <p class="meta" style="margin-top: 8px">Or just <a href="./">read the blog</a> here.</p>
</div>

<ul class="post-list">
  <xsl:for-each select="atom:entry">
    <li>
      <div class="text">
        <h2><a href="{substring-after(atom:link/@href, '/blog/')}"><xsl:value-of select="atom:title"/></a></h2>
        <p class="meta"><xsl:value-of select="substring(atom:updated, 1, 10)"/></p>
        <xsl:if test="atom:summary != ''">
          <p><xsl:value-of select="atom:summary"/></p>
        </xsl:if>
      </div>
      <xsl:if test="media:thumbnail">
        <a class="thumb" href="{substring-after(atom:link/@href, '/blog/')}" tabindex="-1" aria-hidden="true">
          <img src="{media:thumbnail/@url}" alt="" loading="lazy"/>
        </a>
      </xsl:if>
    </li>
  </xsl:for-each>
</ul>
</div>
</body>
</html>
</xsl:template>

</xsl:stylesheet>
