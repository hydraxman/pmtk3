"use strict";
(() => {
  const cards = Array.from(document.querySelectorAll(".card"));
  const search = document.getElementById("search");
  const status = document.getElementById("status");
  const buttons = Array.from(document.querySelectorAll("[data-chapter]"));
  let chapter = "*";
  function filter() {
    const query = search.value.toLowerCase().trim();
    let count = 0;
    for (const card of cards) {
      const chapters = JSON.parse(card.dataset.chapters);
      const shown = (!query || card.dataset.search.includes(query)) &&
        (status.value === "*" || card.dataset.status === status.value) &&
        (chapter === "*" || chapters.includes(chapter));
      card.hidden = !shown;
      if (shown) count++;
    }
    document.getElementById("visible").textContent = `${count} of ${cards.length} unique entries shown`;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.chapter === chapter));
  }
  search.addEventListener("input", filter);
  status.addEventListener("change", filter);
  for (const button of buttons) button.addEventListener("click", () => { chapter = button.dataset.chapter; filter(); });
  document.getElementById("reset").addEventListener("click", () => { search.value = ""; status.value = "*"; chapter = "*"; filter(); });
  filter();
})();
