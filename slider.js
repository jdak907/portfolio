import { buildModel, levelLegend } from "./cv-model.js";
import {
  certsHtml,
  entryArticle,
  esc,
  personLinks,
  positioningHtml,
  skillsHtml,
  syncReveals,
  volunteeringHtml
} from "./cv-view.js";

const main = document.getElementById("main");
const input = document.getElementById("level");

function initialLevel() {
  const fromDom = Number(document.documentElement.dataset.level);
  if (fromDom >= 1 && fromDom <= 4) return fromDom;
  return 1;
}

function showError(message) {
  main.innerHTML = `<div class="cv-column"><p class="error">${message}</p></div>`;
  main.dataset.cvReady = "error";
}

function render(model) {
  main.innerHTML = `<div class="cv-column">
    <header class="cv-hero">
      <p class="eyebrow">Curriculum vitae</p>
      <h1>${esc(model.person.name)}</h1>
      ${model.person.location ? `<p class="loc">${esc(model.person.location)}</p>` : ""}
      <p class="cta">${personLinks(model.person)}</p>
      <div class="positioning">${positioningHtml(model.positioning)}</div>
    </header>
    <section id="experience">
      <h2>Experience</h2>
      <p class="sub">${model.roles.length} roles. Higher levels keep everything above them and add the next layer.</p>
      ${model.roles.map(entryArticle).join("")}
    </section>
    <section id="projects">
      <h2>Projects</h2>
      <p class="sub">${model.projects.length} projects, with the same four levels.</p>
      ${model.projects.map(entryArticle).join("")}
    </section>
    <section id="skills">
      <h2>Skills</h2>
      <p class="sub">${model.skills.length} groups. Names at level 1, skills from level 2, and the long groups in full at level 3.</p>
      ${skillsHtml(model.skills)}
    </section>
    <section id="certifications">
      <h2>Certifications</h2>
      <p class="sub">${model.certifications.length} certifications. Issuer, date, and credential details arrive as the level rises.</p>
      ${certsHtml(model.certifications, model.courses)}
    </section>
    <section id="volunteering">
      <h2>Volunteering</h2>
      <p class="sub">${model.volunteering.length} roles, plus organizations.</p>
      ${volunteeringHtml(model.volunteering, model.organizations)}
    </section>
  </div>`;
  main.dataset.roles = String(model.roles.length);
  main.dataset.projects = String(model.projects.length);
  main.dataset.cvReady = "true";
}

function applyLevel(model, level, { writeUrl = true } = {}) {
  const next = Math.min(4, Math.max(1, level));
  document.documentElement.dataset.level = String(next);
  input.value = String(next);
  const caption = levelLegend(model, next);
  input.setAttribute("aria-valuenow", String(next));
  input.setAttribute("aria-valuetext", `Level ${next}. ${caption}`);
  document.getElementById("level-kicker").textContent = `Level ${next}`;
  document.getElementById("level-name").textContent = caption;
  document.querySelectorAll("[data-set-level]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.setLevel === String(next) ? "true" : "false");
  });
  syncReveals(document, next);
  if (writeUrl) {
    const url = new URL(location.href);
    url.searchParams.set("level", String(next));
    history.replaceState(null, "", url);
  }
}

async function start() {
  try {
    const response = await fetch(new URL("data/cv_public.json", document.baseURI));
    if (!response.ok) throw new Error(String(response.status));
    const model = buildModel(await response.json());
    if (!model.roles.length || !model.projects.length) throw new Error("empty");
    render(model);
    applyLevel(model, initialLevel(), { writeUrl: false });
    input.addEventListener("input", () => applyLevel(model, Number(input.value)));
    document.querySelectorAll("[data-set-level]").forEach((button) => {
      button.addEventListener("click", () => applyLevel(model, Number(button.dataset.setLevel)));
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.classList.add("is-settled"));
    });
  } catch (error) {
    showError("The CV didn’t load. From the repository folder, run <code>python3 -m http.server</code> and open this page over http.");
    console.error(error);
  }
}

start();
