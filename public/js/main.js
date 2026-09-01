'use strict';
/**
 * Global UI helpers for the public site:
 *  - scroll progress bar (top of the page)
 *  - back-to-top button
 *  - one-shot typewriter effect for the homepage tagline
 * All features are progressive enhancements: they no-op when their elements
 * are missing, and animation is skipped under prefers-reduced-motion.
 */
(function () {
  var reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var docEl = document.documentElement;

  function scrollTop() {
    return window.scrollY || docEl.scrollTop || 0;
  }

  /* ── Scroll progress bar ── */
  var progress = document.getElementById('scrollProgress');
  if (progress) {
    var ticking = false;
    var updateProgress = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var scrollable = docEl.scrollHeight - docEl.clientHeight;
        var ratio = scrollable > 0 ? scrollTop() / scrollable : 0;
        progress.style.width = (Math.min(1, Math.max(0, ratio)) * 100).toFixed(2) + '%';
        ticking = false;
      });
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }

  /* ── Back to top ── */
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    var toggleButton = function () {
      backToTop.classList.toggle('visible', scrollTop() > 400);
    };
    window.addEventListener('scroll', toggleButton, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    toggleButton();
  }

  /* ── Typewriter effect (homepage tagline) ── */
  var typewriter = document.getElementById('typewriterLine');
  if (typewriter && !reducedMotion) {
    var text = typewriter.getAttribute('data-text') || typewriter.textContent || '';
    if (text) {
      var index = 0;
      typewriter.textContent = '';
      var typeNext = function () {
        index += 1;
        typewriter.textContent = text.slice(0, index);
        if (index < text.length) {
          setTimeout(typeNext, 55 + Math.random() * 55);
        }
      };
      setTimeout(typeNext, 350);
    }
  }
})();
