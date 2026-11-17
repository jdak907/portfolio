(function () {
  var root = document.documentElement;
  var nav = document.querySelector(".nav");

  function sync() {
    if (nav) root.style.setProperty("--nav-h", nav.offsetHeight + "px");
    root.classList.toggle("at-top", window.scrollY < 24);
  }

  sync();
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".rise").forEach(function (el) { el.classList.add("is-in"); });
    return;
  }

  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".rise").forEach(function (el) { el.classList.add("is-in"); });
    return;
  }

  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      seen.unobserve(entry.target);
    });
  }, { threshold: 0, rootMargin: "0px 0px -10% 0px" });

  document.querySelectorAll(".rise").forEach(function (el) { seen.observe(el); });
})();
