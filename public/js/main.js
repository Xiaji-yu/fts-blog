'use strict';
/**
 * Global UI helpers for the public site:
 *  - page load progress bar (blueprint ruler style)
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

  var _timers = [];

  function scrollTop() {
    return window.scrollY || docEl.scrollTop || 0;
  }

  /* ── Drum list (archive page) ── */
  var drumViewport = document.getElementById('drumViewport');
  if (drumViewport) {
    var drumTrack = document.getElementById('drumTrack');
    var drumItems = drumTrack ? drumTrack.querySelectorAll('.drum-item') : [];
    if (drumItems.length) {
      var drumItemHeight = 110;
      var drumIndex = 0;

      function getDrumVisibleCount() {
        return Math.max(1, Math.floor(drumViewport.clientHeight / drumItemHeight));
      }

      function updateDrum() {
        var visible = getDrumVisibleCount();
        var offset = drumIndex * drumItemHeight;
        var center = (drumViewport.clientHeight - drumItemHeight) / 2;
        drumTrack.style.transform = 'translateY(' + (center - offset) + 'px)';
        drumItems.forEach(function (item, i) {
          item.classList.toggle('active', i === drumIndex);
          item.setAttribute('aria-selected', i === drumIndex ? 'true' : 'false');
        });
      }

      function setDrumIndex(next) {
        next = Math.max(0, Math.min(drumItems.length - 1, next));
        if (next !== drumIndex) {
          drumIndex = next;
          updateDrum();
        }
      }

      drumViewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        if (e.deltaY > 0) setDrumIndex(drumIndex + 1);
        if (e.deltaY < 0) setDrumIndex(drumIndex - 1);
      }, { passive: false });

      document.addEventListener('keydown', function (e) {
        if (document.activeElement !== drumViewport) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setDrumIndex(drumIndex + 1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setDrumIndex(drumIndex - 1); }
      });

      var touchStartY = 0;
      var touchOffset = 0;
      var isTouching = false;
      var suppressClick = false;
      var justSwiped = false;

      drumViewport.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        touchStartY = e.touches[0].clientY;
        touchOffset = 0;
        isTouching = true;
        suppressClick = false;
        justSwiped = false;
      }, { passive: true });

      drumViewport.addEventListener('touchmove', function (e) {
        if (!isTouching || e.touches.length !== 1) return;
        e.preventDefault();
        var y = e.touches[0].clientY;
        var raw = y - touchStartY;

        if (!suppressClick && Math.abs(raw) > 8) {
          suppressClick = true;
        }

        var center = (drumViewport.clientHeight - drumItemHeight) / 2;
        var base = drumIndex * drumItemHeight;
        var pixelOffset = base + raw;
        var maxPixelOffset = Math.max(0, (drumItems.length - 1) * drumItemHeight);

        if (pixelOffset < 0) {
          var overTop = -pixelOffset;
          raw = raw * (1 - Math.min(0.75, overTop * 0.35 / drumItemHeight));
        } else if (pixelOffset > maxPixelOffset) {
          var overBottom = pixelOffset - maxPixelOffset;
          raw = raw * (1 - Math.min(0.75, overBottom * 0.35 / drumItemHeight));
        }

        touchOffset = raw;
        drumTrack.style.transform = 'translateY(' + (center - base + raw) + 'px)';
      }, { passive: false });

      drumViewport.addEventListener('touchend', function (e) {
        if (!isTouching) return;
        isTouching = false;

        if (suppressClick && Math.abs(touchOffset) > 8) {
          var rawStep = -touchOffset / drumItemHeight;
          var step = Math.round(rawStep);
          step = Math.max(-2, Math.min(2, step));
          setDrumIndex(drumIndex + step);
          justSwiped = true;
          setTimeout(function () { justSwiped = false; }, 400);
        }

        touchOffset = 0;
        suppressClick = false;
      }, { passive: true });

      drumViewport.addEventListener('click', function (e) {
        if (justSwiped) {
          justSwiped = false;
          return;
        }
        var item = e.target.closest('.drum-item');
        if (!item) return;
        var idx = parseInt(item.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          drumIndex = idx;
          updateDrum();
        }
      });

      drumViewport.addEventListener('dblclick', function (e) {
        var item = e.target.closest('.drum-item');
        if (item) {
          e.preventDefault();
          window.location.href = item.getAttribute('href');
        }
      });

      updateDrum();
    }
  }

  /* ── Drawing loader (article transition) ── */
  var drawingLoader = document.getElementById('drawingLoader');
  var drawingBar = document.getElementById('drawingBar');
  var drawingPercent = document.getElementById('drawingPercent');
  var isArticlePage = !!drawingLoader;

  function runDrawingLoader(callback) {
    if (!drawingLoader || reducedMotion) {
      if (callback) callback();
      return;
    }
    drawingLoader.classList.add('active');
    var duration = 900;
    var pauseRatio = 0.25 + Math.random() * 0.4;
    var pauseDuration = 160;
    var start = null;

    function tick(now) {
      if (!start) start = now;
      var elapsed = now - start;
      var ratio = Math.min(1, elapsed / duration);

      if (ratio < pauseRatio) {
        var eased = 1 - Math.pow(1 - ratio / pauseRatio, 3);
        var pct = Math.round(eased * pauseRatio * 100);
        if (drawingBar) drawingBar.style.width = pct + '%';
        if (drawingPercent) drawingPercent.textContent = pct + '%';
        requestAnimationFrame(tick);
      } else if (ratio < pauseRatio + pauseDuration / duration) {
        var pct = Math.round(pauseRatio * 100);
        if (drawingBar) drawingBar.style.width = pct + '%';
        if (drawingPercent) drawingPercent.textContent = pct + '%';
        requestAnimationFrame(tick);
      } else {
        var finish = Math.min(1, (elapsed - pauseRatio * duration - pauseDuration) / (duration - pauseRatio * duration - pauseDuration));
        finish = isNaN(finish) ? 1 : finish;
        var easedFinish = 1 - Math.pow(1 - finish, 3);
        var finalPct = Math.round((pauseRatio + easedFinish * (1 - pauseRatio)) * 100);
        if (drawingBar) drawingBar.style.width = finalPct + '%';
        if (drawingPercent) drawingPercent.textContent = finalPct + '%';

        if (finish < 1) {
          requestAnimationFrame(tick);
        } else {
          setTimeout(function () {
            drawingLoader.classList.remove('active');
            document.documentElement.classList.remove('drawer-ready');
            setTimeout(function () {
              if (drawingLoader.parentNode) drawingLoader.parentNode.removeChild(drawingLoader);
            }, 400);
            if (callback) callback();
          }, 80);
        }
      }
    }

    requestAnimationFrame(tick);
  }

  if (isArticlePage) {
    runDrawingLoader();
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    if (href.indexOf('/post/') !== 0) return;
    if (link.target && link.target !== '_self') return;
    e.preventDefault();
    window.location.href = href;
  });

  /* ── Hover prefetch for article links ── */
  var prefetchTimer = null;
  document.addEventListener('mouseover', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;
    if (href.indexOf('/post/') !== 0) return;
    if (link.target && link.target !== '_self') return;
    prefetchTimer = setTimeout(function () {
      fetch(href, { mode: 'no-cors' });
    }, 100);
  });
  document.addEventListener('mouseout', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    if (prefetchTimer) {
      clearTimeout(prefetchTimer);
      prefetchTimer = null;
    }
  });

  /* ── Search form loading state ── */
  var searchForms = document.querySelectorAll('.search-form');
  searchForms.forEach(function (form) {
    form.addEventListener('submit', function () {
      form.classList.add('loading');
    });
  });
  var splash = document.getElementById('pageSplash');
  if (!splash) {
    // no splash on this page
  } else if (reducedMotion) {
    splash.classList.add('done');
  } else {
    var bar = document.getElementById('splashBar');
    var percentEl = document.getElementById('splashPercent');
    var stamp = splash.querySelector('.page-splash-stamp');

    document.body.classList.add('page-splash-active');
    splash.classList.add('stamp-visible');

    var duration = 1000;
    var pauseRatio = 0.3 + Math.random() * 0.4;
    var pauseDuration = 180;
    var start = null;

    function tick(now) {
      if (!start) start = now;
      var elapsed = now - start;
      var ratio = Math.min(1, elapsed / duration);

      if (ratio < pauseRatio) {
        var eased = 1 - Math.pow(1 - ratio / pauseRatio, 3);
        var pct = Math.round(eased * pauseRatio * 100);
        if (bar) bar.style.transform = 'scaleX(' + (pct / 100) + ')';
        if (percentEl) percentEl.textContent = pct + '%';
        requestAnimationFrame(tick);
      } else if (ratio < pauseRatio + pauseDuration / duration) {
        var pct = Math.round(pauseRatio * 100);
        if (bar) bar.style.transform = 'scaleX(' + (pct / 100) + ')';
        if (percentEl) percentEl.textContent = pct + '%';
        requestAnimationFrame(tick);
      } else {
        var finish = Math.min(1, (elapsed - pauseRatio * duration - pauseDuration) / (duration - pauseRatio * duration - pauseDuration));
        finish = isNaN(finish) ? 1 : finish;
        var easedFinish = 1 - Math.pow(1 - finish, 3);
        var finalPct = Math.round((pauseRatio + easedFinish * (1 - pauseRatio)) * 100);
        if (bar) bar.style.transform = 'scaleX(' + (finalPct / 100) + ')';
        if (percentEl) percentEl.textContent = finalPct + '%';

        if (finish < 1) {
          requestAnimationFrame(tick);
        } else {
          window.scrollTo(0, 0);
          setTimeout(function () {
            splash.classList.add('done');
            document.body.classList.remove('page-splash-active');
            document.body.classList.add('loaded');
            setTimeout(function () {
              if (splash.parentNode) splash.parentNode.removeChild(splash);
            }, 650);
          }, 80);
        }
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(function () { requestAnimationFrame(tick); }, 30);
    } else {
      window.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { requestAnimationFrame(tick); }, 30);
      });
    }
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
        progress.style.transform = 'scaleX(' + Math.min(1, Math.max(0, ratio)).toFixed(4) + ')';
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
      var chars = Array.from(text);
      var index = 0;
      typewriter.textContent = '';
      var typeNext = function () {
        index += 1;
        typewriter.textContent = chars.slice(0, index).join('');
        if (index < chars.length) {
          var typeTimer = setTimeout(typeNext, 55 + Math.random() * 55);
          _timers.push(typeTimer);
        }
      };
      var typeTimer = setTimeout(typeNext, 350);
      _timers.push(typeTimer);
    }
  }

  /* ── Timer cleanup on unload ── */
  window.addEventListener('beforeunload', function () {
    _timers.forEach(function (id) { clearTimeout(id); });
  });
  window.addEventListener('pagehide', function () {
    _timers.forEach(function (id) { clearTimeout(id); });
  });
})();
