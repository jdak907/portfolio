import { buildModel, levelLegend } from "./cv-model.js";
import { syncReveals, timelineHtml } from "./cv-view.js";

const list = document.getElementById("experience-list");
const input = document.getElementById("level");
const ticks = document.querySelector(".level-ticks");

function initialLevel() {
  const n = Number(document.documentElement.dataset.level);
  return n >= 1 && n <= 4 ? n : 1;
}

function showError() {
  list.replaceChildren();
  const item = document.createElement("li");
  item.className = "loading";
  item.textContent = "Experience didn’t load. From the repository folder, run python3 -m http.server and open this page over http.";
  list.append(item);
  list.dataset.cvReady = "error";
}

function applyLevel(model, level, { writeUrl = false } = {}) {
  const next = Math.min(4, Math.max(1, Number(level) || 1));
  document.documentElement.dataset.level = String(next);
  input.value = String(next);
  const caption = levelLegend(model, next);
  input.setAttribute("aria-valuenow", String(next));
  input.setAttribute("aria-valuetext", `Level ${next}. ${caption}`);
  document.getElementById("level-kicker").textContent = `Level ${next}`;
  document.getElementById("level-name").textContent = caption;
  ticks.querySelectorAll("[data-set-level]").forEach((button) => {
    const on = button.dataset.setLevel === String(next);
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.tabIndex = on ? 0 : -1;
  });
  syncReveals(list, next);
  if (writeUrl) {
    const url = new URL(location.href);
    url.searchParams.set("level", String(next));
    history.replaceState(null, "", url);
  }
}

function onTickKeydown(event) {
  const buttons = [...ticks.querySelectorAll("[data-set-level]")];
  const index = buttons.findIndex((button) => button.getAttribute("aria-checked") === "true");
  if (index < 0) return;
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].click();
}

async function start() {
  try {
    const response = await fetch(new URL("data/cv_public.json", document.baseURI));
    if (!response.ok) throw new Error(String(response.status));
    const model = buildModel(await response.json());
    if (!model.roles.length) throw new Error("empty");
    list.innerHTML = timelineHtml(model.roles);
    list.dataset.roles = String(model.roles.length);
    list.dataset.cvReady = "true";
    applyLevel(model, initialLevel(), { writeUrl: false });
    input.addEventListener("input", () => applyLevel(model, Number(input.value), { writeUrl: true }));
    ticks.querySelectorAll("[data-set-level]").forEach((button) => {
      button.addEventListener("click", () => applyLevel(model, Number(button.dataset.setLevel), { writeUrl: true }));
    });
    ticks.addEventListener("keydown", onTickKeydown);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.documentElement.classList.add("is-settled"));
    });
  } catch (error) {
    showError();
    console.error(error);
  }
}

start();
