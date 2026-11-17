import { buildModel, clip, findEntry, levelLegend, metaLine, visibleBullets } from "./cv-model.js";
import { entryBody, esc, personLinks, safeUrl, syncReveals } from "./cv-view.js";

const d3 = globalThis.d3;
const desktopQuery = window.matchMedia("(max-width: 860px)");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  open: new Set(),
  level: new Map(),
  focus: "root",
  fit: "auto"
};

let model = null;
let tree = null;
let registry = new Map();
let svg = null;
let viewport = null;
let content = null;
let zoomBehavior = null;
let fittedOnce = false;

const main = document.getElementById("main");
const reader = document.getElementById("reader");
const mobile = document.getElementById("mobile");
const stage = document.getElementById("stage");
const status = document.getElementById("status");

function showError(message) {
  reader.innerHTML = `<p class="error">${message}</p>`;
  main.dataset.cvReady = "error";
}

function branchOf(entry) {
  return entry.kind === "project" ? "projects" : "experience";
}

function register(node) {
  registry.set(node.id, node);
  if (Array.isArray(node.children)) node.children.forEach(register);
  return node;
}

function prune(node) {
  if (Array.isArray(node.children)) {
    node.children = node.children.filter(Boolean);
    if (!node.children.length) delete node.children;
  }
  return node;
}

function note(entry, suffix, tag, text) {
  return {
    id: `${entry.id}:${suffix}`,
    kind: "note",
    branch: branchOf(entry),
    label: `${tag} · ${clip(text, 46)}`,
    full: text,
    levelTag: tag,
    parentId: entry.id
  };
}

function roleNode(entry) {
  const level = state.level.get(entry.id) || 0;
  const children = [];
  if (level >= 1 && entry.l1) children.push(note(entry, "l1", "L1", entry.l1));
  if (level >= 2) {
    visibleBullets(entry, 2).forEach((bullet, index) => children.push(note(entry, `l2-${index}`, "L2", bullet.text)));
  }
  if (level >= 3) {
    visibleBullets(entry, 3)
      .filter((bullet) => bullet.level >= 3)
      .forEach((bullet, index) => children.push(note(entry, `l3-${index}`, "L3", bullet.text)));
  }
  if (level >= 4) {
    for (const group of entry.l4) {
      children.push({
        id: `${entry.id}:l4:${group.key}`,
        kind: "cluster",
        branch: branchOf(entry),
        label: `${group.label} · ${group.items.length}`,
        full: `${group.label}: ${group.items.join(", ")}`,
        items: group.items,
        linkItems: group.key === "links",
        levelTag: "L4",
        parentId: entry.id,
        children: group.items.map((item, index) => ({
          id: `${entry.id}:l4:${group.key}:${index}`,
          kind: "leaf",
          branch: branchOf(entry),
          label: clip(item, 42),
          full: item,
          href: group.key === "links" ? item : "",
          levelTag: "L4",
          parentId: entry.id
        }))
      });
    }
    if (entry.altTitles.length) {
      children.push(note(entry, "alt", "L4", `Also listed as: ${entry.altTitles.join("; ")}`));
    }
  }
  return prune({
    id: entry.id,
    kind: "entry",
    entryKind: entry.kind,
    entry,
    branch: branchOf(entry),
    level,
    label: level ? `${clip(entry.title, 24)} · L${level}` : clip(entry.title, 28),
    full: [entry.title, entry.org].filter(Boolean).join(", "),
    children
  });
}

function catalog() {
  return [
    {
      id: "experience",
      label: "Experience",
      count: model.roles.length,
      indexItems: model.roles.map((entry) => ({ id: entry.id, label: entry.title, sub: entry.org })),
      children: () => model.roles.map(roleNode)
    },
    {
      id: "projects",
      label: "Projects",
      count: model.projects.length,
      indexItems: model.projects.map((entry) => ({ id: entry.id, label: entry.title, sub: entry.dates })),
      children: () => model.projects.map(roleNode)
    },
    {
      id: "skills",
      label: "Skills",
      count: model.skills.length,
      indexItems: model.skills.map((group) => ({ id: group.id, label: group.group, sub: `${group.items.length} skills` })),
      children: () => model.skills.map((group) => prune({
        id: group.id,
        kind: "group",
        branch: "skills",
        label: clip(`${group.group} · ${group.items.length}`, 32),
        full: group.group,
        items: group.items,
        children: state.open.has(group.id)
          ? group.items.map((name, index) => ({
            id: `${group.id}-${index}`,
            kind: "leaf",
            branch: "skills",
            label: clip(name, 34),
            full: name,
            parentId: group.id,
            groupName: group.group
          }))
          : undefined
      }))
    },
    {
      id: "certifications",
      label: "Certifications",
      count: model.certifications.length,
      indexItems: model.certifications.map((cert) => ({ id: cert.id, label: cert.name, sub: cert.issuer })),
      children: () => {
        const nodes = model.certifications.map((cert) => ({
          id: cert.id,
          kind: "leaf",
          branch: "certifications",
          label: clip(cert.name, 34),
          full: [cert.name, cert.issuer, cert.date].filter(Boolean).join(" · "),
          cert
        }));
        if (model.courses.length) {
          nodes.push(prune({
            id: "courses",
            kind: "group",
            branch: "certifications",
            label: `Courses · ${model.courses.length}`,
            full: "Courses",
            items: model.courses.map((course) => course.context ? `${course.name} — ${course.context}` : course.name),
            children: state.open.has("courses")
              ? model.courses.map((course) => ({
                id: course.id,
                kind: "leaf",
                branch: "certifications",
                label: clip(course.name, 34),
                full: course.context ? `${course.name} — ${course.context}` : course.name,
                parentId: "courses"
              }))
              : undefined
          }));
        }
        return nodes;
      }
    },
    {
      id: "volunteering",
      label: "Volunteering",
      count: model.volunteering.length + model.organizations.length,
      indexItems: model.volunteering
        .map((item) => ({ id: item.id, label: item.org, sub: item.role }))
        .concat(model.organizations.map((org) => ({ id: org.id, label: org.name, sub: "Organization" }))),
      children: () => model.volunteering.map((item) => ({
        id: item.id,
        kind: "leaf",
        branch: "volunteering",
        label: clip(item.org, 28),
        full: [item.org, item.role, item.text].filter(Boolean).join(" — "),
        vol: item
      })).concat(model.organizations.map((org) => ({
        id: org.id,
        kind: "leaf",
        branch: "volunteering",
        label: clip(org.name, 32),
        full: org.name,
        org
      })))
    },
    {
      id: "about",
      label: "About",
      count: model.positioning.length,
      indexItems: model.positioning.map((item) => ({ id: item.id, label: item.label, sub: "" })),
      children: () => model.positioning.map((item) => ({
        id: item.id,
        kind: "leaf",
        branch: "about",
        label: clip(item.label, 28),
        full: item.text,
        positioning: item
      }))
    }
  ];
}

function rebuildTree() {
  registry = new Map();
  const children = catalog().map((branch) => prune({
    id: branch.id,
    kind: "branch",
    branch: branch.id,
    label: `${branch.label} · ${branch.count}`,
    full: `${branch.label}, ${branch.count}`,
    count: branch.count,
    indexItems: branch.indexItems,
    children: state.open.has(branch.id) ? branch.children() : undefined
  }));
  tree = register(prune({
    id: "root",
    kind: "root",
    label: model.person.name,
    full: [model.person.name, model.person.location].filter(Boolean).join(", "),
    children
  }));
}

function ensureAncestors(id) {
  if (!id || id === "root") return;
  const entry = findEntry(model, id);
  if (entry) {
    state.open.add(branchOf(entry));
    return;
  }
  if (model.skills.some((group) => group.id === id) || /^skill-\d+-\d+$/.test(id)) state.open.add("skills");
  const skillLeaf = id.match(/^(skill-\d+)-\d+$/);
  if (skillLeaf) state.open.add(skillLeaf[1]);
  if (id.startsWith("cert-") || id === "courses" || id.startsWith("course-")) state.open.add("certifications");
  if (id === "courses" || id.startsWith("course-")) state.open.add("courses");
  if (id.startsWith("vol-") || id.startsWith("org-")) state.open.add("volunteering");
  if (model.positioning.some((item) => item.id === id)) state.open.add("about");
  if (id.includes(":")) {
    const parent = id.split(":")[0];
    ensureAncestors(parent);
    const minimum = id.includes(":l4") || id.includes(":alt") ? 4 : id.includes(":l3") ? 3 : id.includes(":l2") ? 2 : 1;
    state.level.set(parent, Math.max(state.level.get(parent) || 0, minimum));
  }
}

function initFromUrl() {
  const params = new URLSearchParams(location.search);
  (params.get("open") || "").split(",").filter(Boolean).forEach((id) => state.open.add(id));
  const focus = params.get("focus");
  const level = Number(params.get("level"));
  const fit = params.get("fit");
  if (focus) state.focus = focus;
  (params.get("levels") || "").split(",").forEach((pair) => {
    const splitAt = pair.lastIndexOf(":");
    if (splitAt <= 0) return;
    const id = pair.slice(0, splitAt);
    const value = Number(pair.slice(splitAt + 1));
    if (id && value >= 1 && value <= 4) state.level.set(id, value);
  });
  if (focus && level >= 1 && level <= 4) {
    const entryId = focus.includes(":") ? focus.split(":")[0] : focus;
    if (findEntry(model, entryId)) state.level.set(entryId, level);
  }
  if (fit === "all" || fit === "focus") state.fit = fit;
  ensureAncestors(state.focus);
}

function syncUrl() {
  const url = new URL(location.href);
  const open = [...state.open];
  if (open.length) url.searchParams.set("open", open.join(","));
  else url.searchParams.delete("open");
  if (state.focus && state.focus !== "root") url.searchParams.set("focus", state.focus);
  else url.searchParams.delete("focus");
  const entryId = state.focus && state.focus.includes(":") ? state.focus.split(":")[0] : state.focus;
  const level = state.level.get(entryId) || 0;
  if (level && findEntry(model, entryId)) url.searchParams.set("level", String(level));
  else url.searchParams.delete("level");
  const levels = [...state.level.entries()].filter(([, value]) => value > 0).map(([id, value]) => `${id}:${value}`);
  if (levels.length) url.searchParams.set("levels", levels.join(","));
  else url.searchParams.delete("levels");
  if (state.fit !== "auto") url.searchParams.set("fit", state.fit);
  else url.searchParams.delete("fit");
  history.replaceState(null, "", url);
}

function setStatus(text) {
  status.textContent = text;
}

function activate(id) {
  if (!id || id === "root") {
    state.focus = "root";
    draw({ animate: true });
    return;
  }
  const node = registry.get(id);
  const entry = findEntry(model, id);
  if (node && (node.kind === "branch" || node.kind === "group")) {
    if (state.open.has(id)) state.open.delete(id);
    else state.open.add(id);
    state.focus = id;
    if (node.kind === "group") state.open.add(node.branch);
  } else if ((node && node.kind === "entry") || entry) {
    const next = Math.min(4, (state.level.get(id) || 0) + 1);
    state.level.set(id, next);
    state.focus = id;
    state.open.add(entry ? branchOf(entry) : node.branch);
  } else if (node) {
    state.focus = id;
  } else if (id === "courses" || model.skills.some((group) => group.id === id)) {
    if (state.open.has(id)) state.open.delete(id);
    else state.open.add(id);
    state.open.add(id === "courses" ? "certifications" : "skills");
    state.focus = id;
  }
  draw({ animate: true });
}

function setEntryLevel(id, level) {
  state.level.set(id, level);
  state.focus = id;
  state.open.add(branchOf(findEntry(model, id)));
  draw({ animate: true });
}

function resetMap() {
  state.open.clear();
  state.level.clear();
  state.focus = "root";
  state.fit = "auto";
  draw({ animate: !reduceMotion });
}

function indexButtons(items) {
  return `<ul class="index-list">${items.map((item) => `<li><button type="button" data-act="${esc(item.id)}"><strong>${esc(item.label)}</strong>${item.sub ? `<em>${esc(item.sub)}</em>` : ""}</button></li>`).join("")}</ul>`;
}

function levelControl(entry, level) {
  const buttons = [1, 2, 3, 4].map((step) => `<button type="button" data-level-for="${esc(entry.id)}" data-level="${step}" aria-pressed="${step === level ? "true" : "false"}">${step}</button>`).join("");
  return `<div class="reader-level"><div class="segments" role="group" aria-label="Detail level for ${esc(entry.title)}">${buttons}</div><p class="level-caption">Level ${level} · ${esc(levelLegend(model, level))}</p></div>`;
}

function renderReader() {
  const node = registry.get(state.focus) || registry.get("root");
  const existing = reader.querySelector(".focus-card");
  if (node && node.kind === "entry" && existing && existing.dataset.id === node.id) {
    const level = state.level.get(node.id) || 1;
    existing.dataset.level = String(level);
    const caption = reader.querySelector(".level-caption");
    if (caption) caption.textContent = `Level ${level} · ${levelLegend(model, level)}`;
    reader.querySelectorAll("[data-level-for]").forEach((button) => {
      button.setAttribute("aria-pressed", Number(button.dataset.level) === level ? "true" : "false");
    });
    syncReveals(existing, level);
    setStatus(`${node.entry.title}, level ${level} of 4. ${levelLegend(model, level)}`);
    return;
  }

  let html = "";
  if (!node || node.kind === "root") {
    const headline = model.positioning.find((item) => item.id === "li-headline");
    const profile = model.positioning.find((item) => item.id === "cv-profile");
    html = `<p class="reader-kicker">Mind map</p>
      <h2>${esc(model.person.name)}</h2>
      ${model.person.location ? `<p class="loc">${esc(model.person.location)}</p>` : ""}
      <p class="cta">${personLinks(model.person)}</p>
      ${headline ? `<p class="slogan">${esc(headline.text)}</p>` : ""}
      ${profile ? `<p class="profile">${esc(profile.text)}</p>` : ""}
      <p class="reader-tip">Open a branch. On a role or project, each click adds a level: the headline, the impact, the full bullets, then tools, standards, and metrics.</p>
      <ul class="legend">${catalog().map((branch) => `<li><button type="button" data-act="${esc(branch.id)}"><i class="swatch b-${esc(branch.id)}"></i>${esc(branch.label)} <span>${branch.count}</span></button></li>`).join("")}</ul>`;
    setStatus(`${model.person.name}. Choose a branch to open the mind map.`);
  } else if (node.kind === "branch") {
    html = `<p class="reader-kicker">Branch</p><h2>${esc(node.full.split(",")[0])}</h2><p class="reader-tip">${node.indexItems.length} items. Choose one, then keep clicking to go deeper.</p>${indexButtons(node.indexItems)}`;
    setStatus(`${node.label} ${state.open.has(node.id) ? "open" : "closed"}.`);
  } else if (node.kind === "entry") {
    const level = state.level.get(node.id) || 1;
    const meta = metaLine(node.entry);
    html = `<p class="reader-kicker">${node.entry.kind === "project" ? "Project" : "Experience"}</p>
      ${levelControl(node.entry, level)}
      <article class="entry focus-card" data-id="${esc(node.id)}" data-kind="${esc(node.entry.kind)}" data-level="${level}">
        <h3>${esc(node.entry.title)}</h3>
        ${node.entry.org ? `<p class="org">${esc(node.entry.org)}</p>` : ""}
        ${meta ? `<p class="when">${esc(meta)}</p>` : ""}
        ${entryBody(node.entry)}
      </article>
      <p class="reader-tip">Click the role on the map to go one level deeper.</p>`;
    setStatus(`${node.entry.title}, level ${level} of 4. ${levelLegend(model, level)}`);
  } else if (node.kind === "group") {
    const items = node.items || [];
    html = `<p class="reader-kicker">Group</p><h2>${esc(node.full)}</h2>${items.length ? `<ul class="chips">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p class=\"reader-tip\">Open this group on the map to see its items.</p>"}`;
    setStatus(`${node.full}, ${state.open.has(node.id) ? "open" : "closed"}.`);
  } else if (node.cert) {
    const cert = node.cert;
    html = `<p class="reader-kicker">Certification</p><h2>${esc(cert.name)}</h2>
      ${cert.issuer ? `<p class="issuer">${esc(cert.issuer)}</p>` : ""}
      ${cert.date ? `<p class="when">${esc(cert.date)}</p>` : ""}
      ${cert.hours || cert.credential ? `<ul class="chips">${[cert.hours, cert.credential ? `Credential ${cert.credential}` : ""].filter(Boolean).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}`;
    setStatus(cert.name);
  } else if (node.vol) {
    const item = node.vol;
    html = `<p class="reader-kicker">Volunteering</p><h2>${esc(item.org)}</h2>
      ${item.role ? `<p class="org">${esc(item.role)}</p>` : ""}
      ${[item.dates, item.cause].filter(Boolean).length ? `<p class="when">${esc([item.dates, item.cause].filter(Boolean).join(" · "))}</p>` : ""}
      ${item.text ? `<p class="about">${esc(item.text)}</p>` : ""}`;
    setStatus(`${item.org}. ${item.role}`);
  } else if (node.org) {
    html = `<p class="reader-kicker">Organization</p><h2>${esc(node.org.name)}</h2>`;
    setStatus(node.org.name);
  } else if (node.positioning) {
    html = `<p class="reader-kicker">About</p><h2>${esc(node.positioning.label)}</h2><p class="about">${esc(node.positioning.text)}</p>`;
    setStatus(node.positioning.label);
  } else {
    const parent = node.parentId ? registry.get(node.parentId) : null;
    const back = parent ? `<p><button type="button" class="text-btn" data-act="${esc(parent.id)}">Back to ${esc(parent.entry ? parent.entry.title : parent.full || parent.label)}</button></p>` : "";
    const href = node.href ? safeUrl(node.href) : "";
    html = `<p class="reader-kicker">${esc(node.levelTag || "Detail")}</p><p class="about">${href ? `<a href="${esc(href)}" rel="noopener noreferrer">${esc(node.full)}</a>` : esc(node.full)}</p>${back}`;
    setStatus(node.full);
  }

  reader.innerHTML = html;
  reader.querySelectorAll("[data-act]").forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.act));
  });
  reader.querySelectorAll("[data-level-for]").forEach((button) => {
    button.addEventListener("click", () => setEntryLevel(button.dataset.levelFor, Number(button.dataset.level)));
  });
  const card = reader.querySelector(".focus-card");
  if (card) syncReveals(card, Number(card.dataset.level));
}

function renderMobile() {
  const branches = catalog();
  const openBranches = branches.filter((branch) => state.open.has(branch.id));
  mobile.innerHTML = `<div class="m-center"><button type="button" data-act="root" class="${state.focus === "root" ? "is-on" : ""}"><strong>${esc(model.person.name)}</strong>${model.person.location ? `<span>${esc(model.person.location)}</span>` : ""}</button></div>
    <p class="m-label">Branches</p>
    <div class="m-rail">${branches.map((branch) => `<button type="button" class="b-${esc(branch.id)}" data-act="${esc(branch.id)}" aria-pressed="${state.open.has(branch.id) ? "true" : "false"}">${esc(branch.label)} <span>${branch.count}</span></button>`).join("")}</div>
    ${openBranches.map((branch) => `<p class="m-label">${esc(branch.label)}</p><div class="m-items">${branch.indexItems.map((item) => {
      const level = state.level.get(item.id);
      const on = state.focus === item.id || (state.focus || "").startsWith(`${item.id}:`);
      return `<button type="button" data-act="${esc(item.id)}" aria-pressed="${on ? "true" : "false"}">${level ? `<span class="lvl">L${level}</span>` : ""}<strong>${esc(item.label)}</strong>${item.sub ? `<em>${esc(item.sub)}</em>` : ""}</button>`;
    }).join("")}</div>`).join("")}`;
  mobile.querySelectorAll("[data-act]").forEach((button) => {
    button.addEventListener("click", () => activate(button.dataset.act));
  });
}

function isNarrow() {
  return desktopQuery.matches;
}

function normAngle(angle) {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function layoutRadial(root) {
  root.x = 0;
  root.y = 0;
  const branches = root.children || [];
  if (!branches.length) return;
  const minClosed = 0.46;
  const openWeights = branches.map((branch) => {
    const kids = branch.children || [];
    if (!kids.length) return 0;
    return kids.reduce((sum, kid) => sum + 1 + ((kid.children || []).length * 0.85), 0);
  });
  const openTotal = openWeights.reduce((sum, weight) => sum + weight, 0);
  if (!openTotal) {
    const span = (Math.PI * 2) / branches.length;
    branches.forEach((branch, index) => {
      branch.x = normAngle(index * span);
      branch.y = 220;
    });
    return;
  }
  const closedCount = openWeights.filter((weight) => weight === 0).length;
  const reserved = Math.min(closedCount * minClosed, Math.PI * 1.2);
  const remain = Math.max(1.4, Math.PI * 2 - reserved);
  const spans = openWeights.map((weight) => (weight ? remain * (weight / openTotal) : reserved / Math.max(1, closedCount)));
  let cursor = -spans[0] / 2;
  branches.forEach((branch, index) => {
    const span = spans[index];
    branch.x = normAngle(cursor + span / 2);
    branch.y = 188;
    layoutSector(branch, cursor + span * 0.06, cursor + span * 0.94, branch.y);
    cursor += span;
  });
}

function layoutSector(node, start, end, radius) {
  const kids = node.children || [];
  if (!kids.length) return;
  const weights = kids.map((kid) => 1 + ((kid.children || []).reduce((sum, grand) => sum + 1 + ((grand.children || []).length * 0.6), 0)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const span = Math.max(0.02, end - start);
  let cursor = start;
  kids.forEach((kid, index) => {
    const kidSpan = span * (weights[index] / total);
    kid.x = normAngle(cursor + kidSpan / 2);
    kid.y = radius + 198;
    const pad = Math.min(kidSpan * 0.12, 0.08);
    layoutSector(kid, cursor + pad, cursor + kidSpan - pad, kid.y);
    cursor += kidSpan;
  });
}

function nodeRadius(d) {
  if (d.depth === 0) return 36;
  if (d.data.kind === "branch") return 8;
  if (d.data.kind === "entry") return 6;
  return 4.5;
}

function ariaLabel(d) {
  if (d.data.kind === "entry") {
    const level = d.data.level || 0;
    return level
      ? `${d.data.full}. Detail level ${level} of 4. Activate to go deeper.`
      : `${d.data.full}. Activate to show the headline.`;
  }
  if (d.data.kind === "branch" || d.data.kind === "group") {
    return `${d.data.full}. ${state.open.has(d.data.id) ? "Expanded" : "Collapsed"}.`;
  }
  return d.data.full || d.data.label;
}

function ensureSvg() {
  if (svg) return;
  svg = d3.select(stage).append("svg").attr("role", "group").attr("aria-label", "Mind map");
  viewport = svg.append("g").attr("class", "viewport");
  content = viewport.append("g").attr("class", "content");
  zoomBehavior = d3.zoom().scaleExtent([0.25, 3.2]).on("zoom", (event) => {
    viewport.attr("transform", event.transform);
  });
  svg.call(zoomBehavior);
  svg.on("dblclick.zoom", null);
}

function pathIds(root) {
  const ids = new Set();
  const focus = root.descendants().find((node) => node.data.id === state.focus);
  let current = focus;
  while (current) {
    ids.add(current.data.id);
    current = current.parent;
  }
  return ids;
}

function drawMap(animate) {
  if (!d3 || isNarrow()) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width < 40 || height < 40) return;
  ensureSvg();
  svg.attr("width", width).attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

  const root = d3.hierarchy(tree);
  layoutRadial(root);
  const onPath = pathIds(root);

  content.selectAll("*").remove();
  content.append("g").attr("class", "links").selectAll("path").data(root.links()).join("path")
    .attr("class", (d) => `link b-${d.target.data.branch || "about"}${onPath.has(d.target.data.id) ? " is-on-path" : ""}`)
    .attr("d", d3.linkRadial().angle((d) => d.x).radius((d) => d.y));

  const node = content.append("g").attr("class", "nodes").selectAll("g").data(root.descendants()).join("g")
    .attr("class", (d) => `node kind-${d.data.kind} b-${d.data.branch || "root"}${d.data.id === state.focus ? " is-focus" : ""}${onPath.has(d.data.id) ? " is-on-path" : ""}`)
    .attr("transform", (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`)
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("data-id", (d) => d.data.id)
    .attr("data-entry-kind", (d) => d.data.entryKind || "")
    .attr("aria-label", ariaLabel)
    .attr("aria-expanded", (d) => (d.data.kind === "branch" || d.data.kind === "group") ? String(state.open.has(d.data.id)) : null)
    .on("click", (event, d) => {
      event.stopPropagation();
      activate(d.data.id);
    })
    .on("keydown", (event, d) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(d.data.id);
      }
    });

  node.append("title").text((d) => d.data.full || d.data.label);
  node.append("circle").attr("r", nodeRadius);

  node.each(function (d) {
    const group = d3.select(this);
    if (d.depth === 0) {
      const upright = 90 - (d.x * 180) / Math.PI;
      const text = group.append("text").attr("class", "root-name").attr("text-anchor", "middle").attr("transform", `rotate(${upright})`);
      text.append("tspan").attr("x", 0).attr("dy", "-0.15em").text("Jeff");
      text.append("tspan").attr("x", 0).attr("dy", "1.15em").text("Dumps");
      return;
    }
    const flip = d.x >= Math.PI;
    const inner = group.append("g").attr("class", "label").attr("transform", flip ? "rotate(180)" : null);
    const x = flip ? -14 : 14;
    const text = inner.append("text").attr("class", "node-label").attr("dy", "0.32em").attr("x", x).attr("text-anchor", flip ? "end" : "start").text(d.data.label);
    let length = 0;
    try { length = text.node().getComputedTextLength(); } catch { length = 0; }
    if (!length) length = d.data.label.length * 7.1;
    const pad = 8;
    inner.insert("rect", "text").attr("class", "pill").attr("x", flip ? x - length - pad : x - pad).attr("y", -11).attr("width", length + pad * 2).attr("height", 22).attr("rx", 11);
  });

  fitMap(animate && fittedOnce && !reduceMotion);
  fittedOnce = true;
}

function fitMap(animate) {
  if (!svg || !content) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const focusLevel = state.level.get(state.focus) || (state.focus.includes(":") ? state.level.get(state.focus.split(":")[0]) : 0) || 0;
  const focusMode = state.fit === "focus" || (state.fit !== "all" && focusLevel >= 3);
  const include = new Set();
  if (focusMode) {
    const focusNode = content.selectAll(".node").data().find((node) => node.data.id === state.focus);
    let current = focusNode;
    while (current) {
      include.add(current.data.id);
      current = current.parent;
    }
    if (focusNode) focusNode.descendants().forEach((node) => include.add(node.data.id));
  }
  const nodes = [];
  content.selectAll(".node").each(function (d) {
    if (!focusMode || include.has(d.data.id)) nodes.push(this);
  });
  if (!nodes.length) return;
  const base = d3.zoomIdentity.translate(width / 2, height / 2);
  viewport.attr("transform", base.toString());
  const origin = svg.node().getBoundingClientRect();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((element) => {
    const rect = element.getBoundingClientRect();
    minX = Math.min(minX, rect.left);
    minY = Math.min(minY, rect.top);
    maxX = Math.max(maxX, rect.right);
    maxY = Math.max(maxY, rect.bottom);
  });
  const contentCx = (minX + maxX) / 2 - origin.left - width / 2;
  const contentCy = (minY + maxY) / 2 - origin.top - height / 2;
  const pad = 36;
  const scale = Math.min((width - pad * 2) / Math.max(40, maxX - minX), (height - pad * 2) / Math.max(40, maxY - minY), 1.35);
  const transform = d3.zoomIdentity.translate(width / 2 - scale * contentCx, height / 2 - scale * contentCy).scale(scale);
  const target = animate ? svg.transition().duration(450) : svg;
  target.call(zoomBehavior.transform, transform);
}

function draw(options = {}) {
  rebuildTree();
  renderMobile();
  renderReader();
  if (!isNarrow()) drawMap(Boolean(options.animate));
  syncUrl();
  main.dataset.roles = String(model.roles.length);
  main.dataset.projects = String(model.projects.length);
  main.dataset.cvReady = "true";
}

function bindTools() {
  document.getElementById("zoom-in").addEventListener("click", () => {
    if (svg) svg.transition().duration(180).call(zoomBehavior.scaleBy, 1.25);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    if (svg) svg.transition().duration(180).call(zoomBehavior.scaleBy, 0.8);
  });
  document.getElementById("fit-map").addEventListener("click", () => fitMap(!reduceMotion));
  document.getElementById("reset-map").addEventListener("click", resetMap);
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => draw({ animate: false }), 120);
  });
  desktopQuery.addEventListener("change", () => draw({ animate: false }));
}

async function start() {
  if (!d3) {
    showError("The mind map library didn’t load.");
    return;
  }
  try {
    const response = await fetch(new URL("data/cv_public.json", document.baseURI));
    if (!response.ok) throw new Error(String(response.status));
    model = buildModel(await response.json());
    if (!model.roles.length || !model.projects.length) throw new Error("empty");
    initFromUrl();
    bindTools();
    draw({ animate: false });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.classList.add("is-settled"));
    });
  } catch (error) {
    showError("The CV didn’t load. From the repository folder, run python3 -m http.server and open this page over http.");
    console.error(error);
  }
}

start();
