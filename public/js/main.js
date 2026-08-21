// FTS-BLOG · Frontend JavaScript
// Engineering Blueprint Aesthetic

// Markdown rendering for post content
function renderMarkdown() {
  const contentElements = document.querySelectorAll('[data-markdown]');
  contentElements.forEach(el => {
    const markdown = el.getAttribute('data-markdown');
    const html = marked.parse(markdown);
    // Sanitize rendered HTML to prevent XSS
    el.innerHTML = DOMPurify.sanitize(html);
  });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Form submission handlers for admin
document.querySelectorAll('form[data-ajax]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const response = await fetch(form.action, {
        method: form.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (response.ok) {
        // Success - redirect or show message
        if (result.redirect) {
          window.location.href = result.redirect;
        } else {
          alert(result.message || 'Success');
        }
      } else {
        alert(result.error || 'Error occurred');
      }
    } catch (err) {
      alert('Network error');
    }
  });
});

// Image preview for file inputs
document.querySelectorAll('input[type="file"]').forEach(input => {
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const preview = document.getElementById('image-preview');
        if (preview) {
          preview.src = event.target.result;
          preview.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    }
  });
});

// Auto-save draft (optional)
let autoSaveTimer;
const editorContent = document.getElementById('editor-content');
if (editorContent) {
  editorContent.addEventListener('input', () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      localStorage.setItem('draft', editorContent.value);
    }, 2000);
  });

  // Restore draft
  const draft = localStorage.getItem('draft');
  if (draft) {
    editorContent.value = draft;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  renderMarkdown();
});
