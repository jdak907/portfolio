import { metaLine, visibleBullets } from "./cv-model.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function linkLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (host === "github.com" && parts.length) return parts.join("/");
    if (parts.length) return `${host}/${parts[parts.length - 1]}`;
    return host;
  } catch {
    return "Link";
  }
}

export function syncReveals(scope, level) {
  scope.querySelectorAll(".reveal").forEach((el) => {
    const show = level >= Number(el.dataset.from);
    el.setAttribute("aria-hidden", show ? "false" : "true");
    if (show) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  });
}

function reveal(level, html) {
  return `<div class="reveal from-${level}" data-from="${level}"><div class="reveal-inner">${html}</div></div>`;
}

function bulletList(bullets, cls) {
  if (!bullets.length) return "";
  return `<ul class="bullets ${cls}">${bullets.map((bullet) => `<li>${esc(bullet.text)}</li>`).join("")}</ul>`;
}

function chips(items, { links = false } = {}) {
  return `<ul class="chips">${items.map((item) => {
    if (!links) return `<li>${esc(item)}</li>`;
    const href = safeUrl(item);
    if (!href) return `<li>${esc(item)}</li>`;
    return `<li><a href="${esc(href)}" rel="noopener noreferrer">${esc(linkLabel(href))}</a></li>`;
  }).join("")}</ul>`;
}

function l4Html(entry) {
  const chunks = [];
  if (entry.altTitles.length) {
    chunks.push(`<p class="alts"><span>Also listed as</span> ${entry.altTitles.map((title) => esc(title)).join(" · ")}</p>`);
  }
  for (const group of entry.l4) {
    if (group.key === "context") {
      chunks.push(`<h4>${esc(group.label)}</h4>${group.items.map((item) => `<p class="context">${esc(item)}</p>`).join("")}`);
      continue;
    }
    const long = group.items.some((item) => item.length > 80);
    const body = long
      ? `<ul class="bullets full">${group.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : chips(group.items, { links: group.key === "links" });
    chunks.push(`<h4>${esc(group.label)}</h4>${body}`);
  }
  if (!chunks.length) return "";
  return reveal(4, `<div class="deep"><p class="kicker">Deep detail</p>${chunks.join("")}</div>`);
}

export function entryBody(entry) {
  const impact = visibleBullets(entry, 2);
  const full = visibleBullets(entry, 3).filter((bullet) => bullet.level >= 3);
  return [
    entry.l1 ? `<p class="l1">${esc(entry.l1)}</p>` : "",
    impact.length ? reveal(2, `<p class="kicker">Impact</p>${bulletList(impact, "impact")}`) : "",
    full.length ? reveal(3, `<p class="kicker">In full</p>${bulletList(full, "full")}`) : "",
    l4Html(entry)
  ].join("");
}

export function entryArticle(entry) {
  const meta = metaLine(entry);
  return `<article class="entry" id="${esc(entry.id)}" data-kind="${esc(entry.kind)}" data-id="${esc(entry.id)}">
    <h3>${esc(entry.title)}</h3>
    ${entry.org ? `<p class="org">${esc(entry.org)}</p>` : ""}
    ${meta ? `<p class="when">${esc(meta)}</p>` : ""}
    ${entryBody(entry)}
  </article>`;
}

export function positioningHtml(items) {
  return items.map((item) => {
    if (item.id === "li-areas") {
      const parts = item.text.split("•").map((part) => part.trim()).filter(Boolean);
      return reveal(item.level, `<p class="kicker">Areas of expertise</p>${chips(parts)}`);
    }
    const cls = item.id === "li-headline" ? "slogan" : item.id === "cv-profile" ? "profile" : "about";
    const html = `<p class="${cls}">${esc(item.text)}</p>`;
    return item.level <= 1 ? html : reveal(item.level, html);
  }).join("");
}

export function skillsHtml(skills) {
  return `<div class="card-grid">${skills.map((group) => {
    const preview = group.items.slice(0, 8);
    const rest = group.items.slice(8);
    return `<article class="entry skill" data-skill-group="${esc(group.id)}">
      <h3>${esc(group.group)}</h3>
      <p class="when">${group.items.length} skills</p>
      ${preview.length ? reveal(2, chips(preview)) : ""}
      ${rest.length ? reveal(3, chips(rest)) : ""}
    </article>`;
  }).join("")}</div>`;
}

export function certsHtml(certs, courses) {
  const cards = certs.map((cert) => {
    const deep = [];
    if (cert.hours) deep.push(cert.hours);
    if (cert.credential) deep.push(`Credential ${cert.credential}`);
    return `<article class="entry cert" data-cert="${esc(cert.id)}">
      <h3>${esc(cert.name)}</h3>
      ${cert.issuer ? reveal(2, `<p class="issuer">${esc(cert.issuer)}</p>`) : ""}
      ${cert.date ? reveal(3, `<p class="when">${esc(cert.date)}</p>`) : ""}
      ${deep.length ? reveal(4, chips(deep)) : ""}
    </article>`;
  }).join("");
  const courseItems = courses.map((course) => {
    const context = course.context ? reveal(3, `<span class="when">${esc(course.context)}</span>`) : "";
    return `<li><strong>${esc(course.name)}</strong>${context}</li>`;
  }).join("");
  const courseBlock = courses.length
    ? reveal(2, `<div class="subblock"><h3>Courses</h3><ul class="course-list">${courseItems}</ul></div>`)
    : "";
  return `<div class="card-grid">${cards}</div>${courseBlock}`;
}

export function volunteeringHtml(items, organizations) {
  const cards = items.map((item) => {
    const meta = [item.dates, item.cause].filter(Boolean).join(" · ");
    return `<article class="entry vol" data-vol="${esc(item.id)}">
      <h3>${esc(item.org)}</h3>
      ${item.role ? `<p class="org">${esc(item.role)}</p>` : ""}
      ${meta ? reveal(2, `<p class="when">${esc(meta)}</p>`) : ""}
      ${item.text ? reveal(3, `<p class="about">${esc(item.text)}</p>`) : ""}
    </article>`;
  }).join("");
  const orgs = organizations.length
    ? `<div class="subblock"><h3>Organizations</h3>${chips(organizations.map((org) => org.name))}</div>`
    : "";
  return `<div class="card-grid">${cards}</div>${orgs}`;
}

export function personLinks(person) {
  return person.links.map((link) => {
    const href = safeUrl(link.url);
    if (!href) return "";
    return `<a class="btn ghost" href="${esc(href)}">${esc(link.label)}</a>`;
  }).join("");
}
