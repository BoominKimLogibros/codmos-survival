document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const progressBar = document.querySelector('.scroll-progress span');

const updateScrollProgress = () => {
  if (!progressBar) return;

  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
  progressBar.style.transform = `scaleX(${Math.min(Math.max(progress, 0), 1)})`;
};

window.addEventListener('scroll', updateScrollProgress, { passive: true });
updateScrollProgress();

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealElements = document.querySelectorAll(
  '.section__heading, .feature-card, .mode-card, .video-card, .download__copy, .download-card',
);

if (!reduceMotion && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('reveal-enabled');

  revealElements.forEach((element, index) => {
    element.classList.add('reveal');
    element.style.setProperty('--reveal-index', String(index % 3));
  });

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14 });

  revealElements.forEach((element) => revealObserver.observe(element));
}
