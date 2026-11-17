import { visibleBullets } from "./cv-model.js";

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

function linkLabel(url) {
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

function chips(items, { links = false } = {}) {
  return `<ul class="chips">${items.map((item) => {
    if (!links) return `<li>${esc(item)}</li>`;
    const href = safeUrl(item);
    if (!href) return `<li>${esc(item)}</li>`;
    return `<li><a href="${esc(href)}" rel="noopener noreferrer">${esc(linkLabel(href))}</a></li>`;
  }).join("")}</ul>`;
}

function bulletReveal(entry, level, cls) {
  const bullets = visibleBullets(entry, level).filter((bullet) => (level === 2 ? bullet.level === 2 : bullet.level >= 3));
  if (!bullets.length) return "";
  return reveal(level, `<ul class="bullets ${cls}">${bullets.map((bullet) => `<li>${esc(bullet.text)}</li>`).join("")}</ul>`);
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
  return reveal(4, `<div class="deep">${chunks.join("")}</div>`);
}

function sameValue(roles, key) {
  const values = [...new Set(roles.map((role) => role[key]).filter(Boolean))];
  return values.length === 1 ? values[0] : "";
}

function groupRoles(roles) {
  const nodes = new Map(roles.map((role) => [role.id, { ...role, children: [] }]));
  const roots = [];
  for (const role of roles) {
    const node = nodes.get(role.id);
    if (role.parent && nodes.has(role.parent)) nodes.get(role.parent).children.push(node);
    else roots.push(node);
  }
  const groups = [];
  for (const role of roots) {
    const last = groups[groups.length - 1];
    if (last && last.org && role.org && last.org === role.org) last.roles.push(role);
    else groups.push({ org: role.org, roles: [role] });
  }
  return groups;
}

function roleHtml(role, opts) {
  const bits = [];
  if (opts.nested && role.org) bits.push(role.org);
  if (role.dates) bits.push(role.dates);
  if (!opts.location && role.location) bits.push(role.location);
  if (!opts.type && role.type) bits.push(role.type);
  const pill = /concurrent/i.test(role.type) ? ` <em class="tag-c">concurrent</em>` : "";
  const meta = bits.map((bit) => esc(bit)).join(" · ");
  const cls = opts.nested ? "role role-child" : "role";
  return `<div class="${cls}" id="${esc(role.id)}" data-kind="role">
    <p class="when"><strong>${esc(role.title)}</strong>${pill}${meta ? ` · ${meta}` : ""}</p>
    ${role.l1 ? `<p class="role-line">${esc(role.l1)}</p>` : ""}
    ${bulletReveal(role, 2, "impact")}
    ${bulletReveal(role, 3, "full")}
    ${l4Html(role)}
    ${(role.children || []).map((child) => roleHtml(child, { location: "", type: "", nested: true })).join("")}
  </div>`;
}

function groupHtml(group) {
  const location = sameValue(group.roles, "location");
  const type = sameValue(group.roles, "type");
  const extra = [location, type].filter(Boolean).map((bit) => esc(bit)).join(" · ");
  const head = `<h3>${esc(group.org || "Role")}${extra ? ` <span>· ${extra}</span>` : ""}</h3>`;
  const body = group.roles.map((role) => roleHtml(role, { location, type, nested: false })).join("");
  return `<li>${head}${body}</li>`;
}

export function timelineHtml(roles) {
  return groupRoles(roles).map(groupHtml).join("");
}
