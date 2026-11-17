const POS_LEVEL = {
  "li-headline": 1,
  "cv-profile": 2,
  "li-about-1": 3,
  "li-about-2": 3,
  "li-about-3": 3,
  "li-areas": 4
};

const L4_ORDER = ["standards", "tools", "methods", "metrics", "markets", "links", "context"];

const L4_LABELS = {
  standards: "Standards",
  tools: "Tools",
  methods: "Methods",
  metrics: "Metrics",
  markets: "Markets",
  links: "Links",
  context: "Context"
};

const LEVEL_FALLBACK = {
  L1: "One-line headline",
  L2: "Key impact bullets (2–3)",
  L3: "Full bullets",
  L4: "Deep detail: standards, tools, methods, metrics, context"
};

export function isShown(item) {
  if (!item || typeof item !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(item, "public")) return true;
  return item.public === true;
}

function cleanText(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function l4Groups(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const keys = [
    ...L4_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(raw, key)),
    ...Object.keys(raw).filter((key) => !L4_ORDER.includes(key))
  ];
  const groups = [];
  for (const key of keys) {
    if (/source|private/i.test(key)) continue;
    const value = raw[key];
    let items = [];
    if (typeof value === "string" || typeof value === "number") {
      const text = cleanText(value);
      if (text) items = [text];
    } else if (Array.isArray(value)) {
      items = value.map(cleanText).filter(Boolean);
    }
    if (!items.length) continue;
    groups.push({
      key,
      label: L4_LABELS[key] || key.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      items
    });
  }
  return groups;
}

function collectBullets(entry) {
  const raw = Array.isArray(entry.bullets) ? entry.bullets : [];
  const hidden = new Set(raw.filter((bullet) => bullet && bullet.text && !isShown(bullet)).map((bullet) => cleanText(bullet.text)));
  const bullets = raw
    .filter((bullet) => isShown(bullet) && cleanText(bullet.text))
    .map((bullet) => ({ level: Number(bullet.level) || 3, text: cleanText(bullet.text) }));
  const seen = new Set(bullets.map((bullet) => bullet.text));
  const extras = [];
  for (const [level, key] of [[2, "L2"], [3, "L3"]]) {
    const list = Array.isArray(entry[key]) ? entry[key] : [];
    for (const item of list) {
      const text = cleanText(item);
      if (!text || seen.has(text) || hidden.has(text)) continue;
      extras.push({ level, text });
      seen.add(text);
    }
  }
  return { bullets, extras };
}

function entryFrom(raw, kind, index) {
  const { bullets, extras } = collectBullets(raw);
  return {
    id: cleanText(raw.id) || `${kind}-${index}`,
    kind,
    org: cleanText(raw.org),
    title: cleanText(raw.title),
    altTitles: Array.isArray(raw.alt_titles) ? raw.alt_titles.map(cleanText).filter(Boolean) : [],
    dates: cleanText(raw.dates),
    location: cleanText(raw.location),
    type: cleanText(raw.type),
    l1: cleanText(raw.L1),
    bullets,
    extras,
    l4: l4Groups(raw.L4)
  };
}

export function visibleBullets(entry, level) {
  const out = [];
  if (level >= 2) {
    for (const bullet of entry.bullets) if (bullet.level === 2) out.push(bullet);
    for (const bullet of entry.extras) if (bullet.level === 2) out.push(bullet);
  }
  if (level >= 3) {
    for (const bullet of entry.bullets) if (bullet.level >= 3) out.push(bullet);
    for (const bullet of entry.extras) if (bullet.level >= 3) out.push(bullet);
  }
  return out;
}

export function metaLine(entry) {
  return [entry.dates, entry.location, entry.type].filter(Boolean).join(" · ");
}

export function clip(text, max) {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function levelLegend(model, level) {
  return model.levels[`L${level}`] || LEVEL_FALLBACK[`L${level}`] || "";
}

export function findEntry(model, id) {
  return model.roles.find((entry) => entry.id === id) || model.projects.find((entry) => entry.id === id) || null;
}

export function buildModel(raw) {
  const person = raw && raw.person ? raw.person : {};
  const positioning = (raw.positioning || [])
    .filter(isShown)
    .map((item, index) => ({
      id: cleanText(item.id) || `positioning-${index}`,
      label: cleanText(item.label) || "Note",
      text: cleanText(item.text),
      level: POS_LEVEL[item.id] || 3,
      index
    }))
    .filter((item) => item.text)
    .sort((a, b) => a.level - b.level || a.index - b.index);

  return {
    person: {
      name: cleanText(person.name) || "Jeff Dumps",
      location: cleanText(person.location),
      links: (person.links || [])
        .filter((link) => link && cleanText(link.label) && /^https?:\/\//i.test(String(link.url || "").trim()))
        .map((link) => ({ label: cleanText(link.label), url: String(link.url).trim() }))
    },
    positioning,
    roles: (raw.roles || []).filter(isShown).map((entry, index) => entryFrom(entry, "role", index)),
    projects: (raw.projects || []).filter(isShown).map((entry, index) => entryFrom(entry, "project", index)),
    skills: (raw.skills || [])
      .map((group, index) => ({
        id: `skill-${index}`,
        group: cleanText(group.group),
        items: (group.items || []).filter(isShown).map((item) => cleanText(item.name)).filter(Boolean)
      }))
      .filter((group) => group.group),
    certifications: (raw.certifications || [])
      .filter(isShown)
      .map((cert, index) => ({
        id: `cert-${index}`,
        name: cleanText(cert.name),
        issuer: cleanText(cert.issuer),
        date: cleanText(cert.date),
        credential: cleanText(cert.id),
        hours: cleanText(cert.hours)
      }))
      .filter((cert) => cert.name),
    courses: (raw.courses || [])
      .filter(isShown)
      .map((course, index) => ({
        id: `course-${index}`,
        name: cleanText(course.name),
        context: cleanText(course.context)
      }))
      .filter((course) => course.name),
    volunteering: (raw.volunteering || [])
      .filter(isShown)
      .map((item, index) => ({
        id: `vol-${index}`,
        org: cleanText(item.org),
        role: cleanText(item.role),
        dates: cleanText(item.dates),
        cause: cleanText(item.cause),
        text: cleanText(item.text)
      }))
      .filter((item) => item.org || item.role),
    organizations: (raw.organizations || [])
      .filter(isShown)
      .map((item, index) => ({ id: `org-${index}`, name: cleanText(item.name) }))
      .filter((item) => item.name),
    levels: { ...LEVEL_FALLBACK, ...((raw.meta && raw.meta.levels_legend) || {}) }
  };
}
