// ═══════════════════════════════════════════
//   shoRDs Website — script.js
// ═══════════════════════════════════════════

const pages = ['home','features','how','why','download','contact'];

function showPage(pageId) {
  // Hide all pages
  pages.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.remove('active');
    const navEl = document.getElementById('nav-' + id);
    if (navEl) navEl.classList.remove('active');
  });

  // Show target page
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');
  const navTarget = document.getElementById('nav-' + pageId);
  if (navTarget) navTarget.classList.add('active');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Close mobile menu
  document.getElementById('navLinks').classList.remove('open');
}

// ── Mobile menu ──
function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ── Navbar scroll effect ──
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (window.scrollY > 20) {
    nav.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)';
  } else {
    nav.style.boxShadow = 'none';
  }
});

// ── FAQ accordion ──
function toggleFaq(el) {
  const isOpen = el.classList.contains('open');
  // Close all
  document.querySelectorAll('.faq-item').forEach(item => item.classList.remove('open'));
  // Open clicked if wasn't open
  if (!isOpen) el.classList.add('open');
}

// ── Contact form ──
function submitForm(e) {
  e.preventDefault();
  const name = document.getElementById('contactName').value;
  const email = document.getElementById('contactEmail').value;
  const subject = document.getElementById('contactSubject').value;
  const message = document.getElementById('contactMessage').value;

  if (!name || !email || !message) return;

  // Simulate sending
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  setTimeout(() => {
    document.getElementById('formSuccess').style.display = 'block';
    document.getElementById('contactForm').reset();
    btn.textContent = 'Send Message 📬';
    btn.disabled = false;
    setTimeout(() => {
      document.getElementById('formSuccess').style.display = 'none';
    }, 5000);
  }, 1200);
}

// ── Animate elements on scroll ──
function observeAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  const animatable = document.querySelectorAll(
    '.highlight-card, .step-card, .problem-card, .testimonial-card, .feature-row, .upload-step, .ai-step'
  );
  animatable.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ── Domain pill cycling animation ──
function animateDomainPills() {
  const pills = document.querySelectorAll('.domain-pill');
  let index = 0;
  setInterval(() => {
    pills.forEach(p => p.style.borderColor = '');
    if (pills[index]) {
      pills[index].style.borderColor = 'rgba(124,58,237,0.4)';
      pills[index].style.color = '#C4B5FD';
    }
    index = (index + 1) % pills.length;
  }, 800);
}

// ── Floating cards parallax ──
document.addEventListener('mousemove', (e) => {
  const cards = document.querySelectorAll('.float-card');
  const x = (e.clientX / window.innerWidth - 0.5) * 10;
  const y = (e.clientY / window.innerHeight - 0.5) * 10;
  cards.forEach((card, i) => {
    const factor = (i + 1) * 0.5;
    card.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
  });
});

// ── Smooth counter animation ──
function animateCounter(el, target, suffix = '') {
  let current = 0;
  const step = target / 40;
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }
    el.textContent = Math.floor(current) + suffix;
  }, 30);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  observeAnimations();
  animateDomainPills();

  // Animate stat counters on home page when visible
  const statNums = document.querySelectorAll('.stat-num');
  statNums.forEach(el => {
    const text = el.textContent;
    const num = parseInt(text);
    if (!isNaN(num)) {
      const suffix = text.replace(num.toString(), '');
      el.textContent = '0' + suffix;
      const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          animateCounter(el, num, suffix);
          observer.disconnect();
        }
      });
      observer.observe(el);
    }
  });
});

// ── Add ripple effect to buttons ──
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-primary, .btn-ghost');
  if (!btn) return;
  const ripple = document.createElement('span');
  const rect = btn.getBoundingClientRect();
  ripple.style.cssText = `
    position:absolute;
    border-radius:50%;
    background:rgba(255,255,255,0.2);
    width:4px;height:4px;
    left:${e.clientX-rect.left-2}px;
    top:${e.clientY-rect.top-2}px;
    animation:ripple 0.5s ease-out forwards;
    pointer-events:none;
  `;
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
});

// Add ripple keyframe
const style = document.createElement('style');
style.textContent = `
  @keyframes ripple {
    to { width: 200px; height: 200px; margin-left: -98px; margin-top: -98px; opacity: 0; }
  }
`;
document.head.appendChild(style);
