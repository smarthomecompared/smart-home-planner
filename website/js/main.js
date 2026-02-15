(function () {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14 }
    );
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightbox-image");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const closeBtn = document.getElementById("lightbox-close");

  function closeLightbox() {
    if (lightbox && lightbox.open) {
      lightbox.close();
    }
  }

  if (lightbox && lightboxImage && lightboxCaption) {
    document.querySelectorAll(".shot").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.getAttribute("data-full");
        const title = btn.getAttribute("data-title") || "Screenshot";
        const img = btn.querySelector("img");

        lightboxImage.src = src || "";
        lightboxImage.alt = img ? img.alt : title;
        lightboxCaption.textContent = title;

        if (typeof lightbox.showModal === "function") {
          lightbox.showModal();
        }
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", closeLightbox);
    }

    lightbox.addEventListener("click", (event) => {
      const rect = lightbox.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (!inside) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeLightbox();
      }
    });
  }
})();
