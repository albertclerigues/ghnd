function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
  const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

  for (const tab of tabs) {
    // Prevent drag region from capturing mouse events on buttons
    tab.addEventListener("mousedown", (e) => e.stopPropagation());
    tab.addEventListener("click", () => {
      const target = tab.dataset["tab"];
      if (!target) return;

      for (const t of tabs) t.classList.remove("active");
      for (const p of panels) p.classList.remove("active");

      tab.classList.add("active");
      document.getElementById(`tab-${target}`)?.classList.add("active");
    });
  }
}

document.addEventListener("DOMContentLoaded", initTabs);
