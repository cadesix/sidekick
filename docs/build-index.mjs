// Generates docs/index.html — a self-contained, browsable index of every
// markdown doc in this folder. Rerun after adding or editing docs:
//
//   node docs/build-index.mjs
//
// No dependencies, no server needed; the output works from file://.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = dirname(fileURLToPath(import.meta.url));

// Curated order first, anything new lands after, alphabetically.
const PREFERRED = [
  "creative-brief.md",
  "token-economy.md",
  "guided-sessions.md",
  "MONOREPO.md",
  "SYNC-PLAN.md",
];

const files = readdirSync(docsDir)
  .filter((f) => f.endsWith(".md"))
  .sort((a, b) => {
    const ia = PREFERRED.indexOf(a);
    const ib = PREFERRED.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

// ---------- tiny markdown renderer (headings, lists, tables, fences, quotes) ----------

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0001${codes.length - 1}\u0001`;
  });
  s = esc(s);
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, t, h) => `<a href="${h}">${t}</a>`
  );
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return s.replace(/\u0001(\d+)\u0001/g, (m, i) => codes[+i]);
}

const anchorId = (slug, text) =>
  slug +
  "--" +
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function mdToHtml(md, slug, toc) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  let firstH1Skipped = false;
  const para = [];
  const flush = () => {
    if (para.length) {
      html += `<p>${inline(para.join(" "))}</p>\n`;
      para.length = 0;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flush();
      const code = [];
      let j = i + 1;
      while (j < lines.length && !/^```/.test(lines[j])) code.push(lines[j++]);
      html += `<pre><code>${esc(code.join("\n"))}</code></pre>\n`;
      i = j + 1;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      if (level === 1 && !firstH1Skipped) {
        firstH1Skipped = true; // rendered separately as the article header
        i++;
        continue;
      }
      const text = h[2].trim();
      const id = anchorId(slug, text);
      if (level === 2) toc.push({ id, text });
      html += `<h${level} id="${id}">${inline(text)}</h${level}>\n`;
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flush();
      html += "<hr>\n";
      i++;
      continue;
    }

    if (/^>/.test(line)) {
      flush();
      const q = [];
      let j = i;
      while (j < lines.length && /^>/.test(lines[j]))
        q.push(lines[j++].replace(/^>\s?/, ""));
      const inner = q
        .join("\n")
        .split(/\n\s*\n/)
        .map((p) => `<p>${inline(p.replace(/\n/g, " "))}</p>`)
        .join("");
      html += `<blockquote>${inner}</blockquote>\n`;
      i = j;
      continue;
    }

    if (
      /^\s*\|/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
    ) {
      flush();
      const rows = [];
      let j = i;
      while (j < lines.length && /^\s*\|/.test(lines[j])) rows.push(lines[j++]);
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => inline(c.trim()));
      let t =
        '<div class="tablewrap"><table><thead><tr>' +
        cells(rows[0])
          .map((c) => `<th>${c}</th>`)
          .join("") +
        "</tr></thead><tbody>";
      for (let k = 2; k < rows.length; k++)
        t +=
          "<tr>" +
          cells(rows[k])
            .map((c) => `<td>${c}</td>`)
            .join("") +
          "</tr>";
      html += t + "</tbody></table></div>\n";
      i = j;
      continue;
    }

    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          items.push({ ind: m[1].length, text: [m[3]] });
          j++;
          continue;
        }
        if (/^\s{2,}\S/.test(lines[j]) && items.length) {
          items[items.length - 1].text.push(lines[j].trim());
          j++;
          continue;
        }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      let out = `<${tag}>`;
      let subOpen = false;
      for (const it of items) {
        const content = inline(it.text.join(" "));
        if (it.ind >= 2 && out.endsWith("</li>")) {
          if (!subOpen) {
            out = out.slice(0, -5) + "<ul>";
            subOpen = true;
          }
          out += `<li>${content}</li>`;
        } else {
          if (subOpen) {
            out += "</ul></li>";
            subOpen = false;
          }
          out += `<li>${content}</li>`;
        }
      }
      if (subOpen) out += "</ul></li>";
      html += out + `</${tag}>\n`;
      i = j;
      continue;
    }

    if (!line.trim()) {
      flush();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return html;
}

// ---------- gather docs ----------

const stripMd = (s) =>
  s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*?/g, "");

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const docs = files.map((file) => {
  const raw = readFileSync(join(docsDir, file), "utf8");
  const slug = file.replace(/\.md$/, "").toLowerCase();
  const title = (raw.match(/^#\s+(.+)$/m) || [, file])[1].trim();
  // first prose paragraph after the title, for the overview card
  const body = raw.replace(/^#\s+.+$/m, "");
  const paraMatch = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^[#>|`\-\d]/.test(p) && !p.startsWith("*For"));
  let excerpt = stripMd(paraMatch || "").replace(/\s+/g, " ");
  if (excerpt.length > 180) excerpt = excerpt.slice(0, 177).trimEnd() + "…";
  const words = raw.split(/\s+/).length;
  const toc = [];
  const html = mdToHtml(raw, slug, toc);
  return {
    file,
    slug,
    title,
    excerpt,
    html,
    toc,
    minutes: Math.max(1, Math.round(words / 220)),
    updated: fmt.format(statSync(join(docsDir, file)).mtime),
  };
});

// ---------- page template ----------

const nav = docs
  .map(
    (d) =>
      `<a class="navlink" data-slug="${d.slug}" href="#${d.slug}">${esc(
        d.title
      )}</a>`
  )
  .join("\n      ");

const cards = docs
  .map(
    (d) => `<a class="card" href="#${d.slug}">
        <h2>${esc(d.title)}</h2>
        <p>${esc(d.excerpt)}</p>
        <span class="meta">${d.file} · ${d.minutes} min read · updated ${d.updated}</span>
      </a>`
  )
  .join("\n      ");

const articles = docs
  .map((d) => {
    const toc =
      d.toc.length > 1
        ? `<nav class="toc">${d.toc
            .map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`)
            .join("")}</nav>`
        : "";
    return `<article id="doc-${d.slug}" hidden>
      <header class="dochead">
        <a class="back" href="#">← All docs</a>
        <h1>${esc(d.title)}</h1>
        <div class="meta">${d.minutes} min read · updated ${d.updated} · <a href="${d.file}">open ${d.file}</a></div>
        ${toc}
      </header>
      ${d.html}
    </article>`;
  })
  .join("\n\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sidekick Docs</title>
<style>
:root {
  --bg: #faf9f7; --panel: #ffffff; --fg: #1c1b1f; --muted: #6f6d75;
  --border: #e7e4df; --accent: #6c4ef5; --accent-soft: #efeafe; --code-bg: #f3f1ec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16151a; --panel: #1e1d24; --fg: #eceaf0; --muted: #9c99a6;
    --border: #2c2a34; --accent: #a08bff; --accent-soft: #2a2340; --code-bg: #232129;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 250px; flex-shrink: 0; padding: 56px 16px 28px; border-right: 1px solid var(--border);
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
}
.navtoggle {
  position: fixed; top: 14px; left: 14px; z-index: 10;
  width: 34px; height: 34px; border-radius: 8px; padding: 0;
  border: 1px solid var(--border); background: var(--panel); color: var(--muted);
  font-size: 15px; line-height: 1; cursor: pointer;
}
.navtoggle:hover { color: var(--accent); border-color: var(--accent); }
body.nav-collapsed .sidebar { display: none; }
.brand { display: block; font-weight: 700; font-size: 17px; color: var(--fg); padding: 6px 12px 18px; }
.brand:hover { text-decoration: none; }
.brand span { color: var(--accent); }
.navlink {
  display: block; padding: 7px 12px; margin: 2px 0; border-radius: 8px;
  color: var(--fg); font-size: 14px;
}
.navlink:hover { background: var(--accent-soft); text-decoration: none; }
.navlink.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.sidebar .foot { margin-top: 24px; padding: 0 12px; font-size: 12px; color: var(--muted); }
.sidebar .foot code { font-size: 11px; }

main { flex: 1; min-width: 0; padding: 44px 48px 96px; }
main > * { max-width: 46rem; }

/* overview */
#home h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
#home .sub { color: var(--muted); margin: 0 0 28px; }
.cards { display: grid; gap: 14px; }
.card {
  display: block; background: var(--panel); border: 1px solid var(--border);
  border-radius: 14px; padding: 20px 22px; color: var(--fg);
  transition: border-color .15s, transform .15s;
}
.card:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-1px); }
.card h2 { margin: 0 0 6px; font-size: 17px; letter-spacing: -0.01em; }
.card p { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
.meta { font-size: 12.5px; color: var(--muted); }

/* article */
.dochead { margin-bottom: 8px; }
.back { font-size: 13px; color: var(--muted); display: inline-block; margin-bottom: 18px; }
article h1 { font-size: 27px; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 8px; }
article h2 {
  font-size: 20px; letter-spacing: -0.01em; margin: 40px 0 12px;
  padding-top: 18px; border-top: 1px solid var(--border);
}
article h3 { font-size: 16.5px; margin: 28px 0 8px; }
article h4 { font-size: 15px; margin: 22px 0 6px; }
article p, article li { font-size: 15.5px; }
article li { margin: 4px 0; }
article hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }

.toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 4px; }
.toc a {
  font-size: 12.5px; padding: 4px 10px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
}
.toc a:hover { text-decoration: none; filter: brightness(1.05); }

code {
  font: 0.86em/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  background: var(--code-bg); padding: 1.5px 5px; border-radius: 5px;
}
pre {
  background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 16px; overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: 13px; }

blockquote {
  margin: 16px 0; padding: 2px 18px; border-left: 3px solid var(--accent);
  background: var(--panel); border-radius: 0 10px 10px 0; color: var(--muted);
}
blockquote p { font-size: 14.5px; }

.tablewrap { overflow-x: auto; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .04em; }

@media (max-width: 800px) {
  .layout { flex-direction: column; }
  .sidebar {
    width: 100%; height: auto; position: static; border-right: 0;
    border-bottom: 1px solid var(--border); padding: 16px 16px 12px 58px;
  }
  .sidebar .foot { display: none; }
  main { padding: 28px 20px 80px; }
}
</style>
</head>
<body>
<button class="navtoggle" title="Hide nav" aria-label="Toggle navigation">«</button>
<div class="layout">
  <nav class="sidebar">
    <a class="brand" href="#">Sidekick <span>Docs</span></a>
    ${nav}
    <p class="foot">Generated snapshot — after editing docs, rerun<br><code>node docs/build-index.mjs</code></p>
  </nav>
  <main>
    <section id="home">
      <h1>Sidekick Docs</h1>
      <p class="sub">Product, economy, and architecture docs for the Sidekick monorepo.</p>
      <div class="cards">
      ${cards}
      </div>
    </section>

${articles}
  </main>
</div>
<script>
(function () {
  var slugs = ${JSON.stringify(docs.map((d) => d.slug))};
  function route() {
    var hash = decodeURIComponent(location.hash.slice(1));
    var slug = slugs.find(function (s) { return hash === s || hash.indexOf(s + "--") === 0; }) || "";
    document.getElementById("home").hidden = !!slug;
    slugs.forEach(function (s) {
      document.getElementById("doc-" + s).hidden = s !== slug;
    });
    document.querySelectorAll(".navlink").forEach(function (a) {
      a.classList.toggle("active", a.dataset.slug === slug);
    });
    if (hash && hash !== slug) {
      var el = document.getElementById(hash);
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();

  var NAV_KEY = "sidekick-docs-nav-collapsed";
  var toggle = document.querySelector(".navtoggle");
  function setNav(collapsed) {
    document.body.classList.toggle("nav-collapsed", collapsed);
    toggle.textContent = collapsed ? "\\u2630" : "\\u00ab";
    toggle.title = collapsed ? "Show nav" : "Hide nav";
    try { localStorage.setItem(NAV_KEY, collapsed ? "1" : "0"); } catch (e) {}
  }
  toggle.addEventListener("click", function () {
    setNav(!document.body.classList.contains("nav-collapsed"));
  });
  try { setNav(localStorage.getItem(NAV_KEY) === "1"); } catch (e) {}
})();
</script>
</body>
</html>
`;

writeFileSync(join(docsDir, "index.html"), page);
console.log(
  `Wrote index.html (${(page.length / 1024).toFixed(0)} KB) — ${docs.length} docs: ${docs
    .map((d) => d.file)
    .join(", ")}`
);
