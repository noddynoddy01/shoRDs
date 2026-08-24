// ═════════════════════════════════════════════════════════════════
//   shoRDs Web OS — Desktop Architecture Engine (script.js)
// ═════════════════════════════════════════════════════════════════

let deferredPWAInstallPrompt = null;
let currentView = 'dashboard';
let activePaperId = 'paper-1';
let audioIsPlaying = false;
let audioSpeed = '1.0x';
let audioTimeSeconds = 45;
const audioDurationSeconds = 150;
let audioTimer = null;

const defaultWebPapers = [
  {
    id: 'paper-1',
    title: 'Attention Is All You Need',
    domain: 'AI / ML',
    summary: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, a model architecture based entirely on attention mechanisms.',
    fullExplanation: 'The Transformer replaces recurrent layers with multi-head self-attention mechanisms, enabling parallelization during training and setting state-of-the-art benchmarks in translation quality.',
    context: 'Traditional sequence models like RNNs and LSTMs suffer from sequential execution bottlenecks, limiting training parallelization across GPU clusters.',
    methodology: 'Multi-head self-attention projects queries, keys, and values into sub-spaces to capture long-range contextual relationships concurrently.',
    results: 'Achieved 28.4 BLEU score on WMT 2014 English-to-German translation, outperforming existing ensembles at a fraction of training time.',
    futureScope: 'Extending attention architectures to multi-modal vision, robotics execution, and real-time audio synthesis.',
    authorName: 'Ashish Vaswani et al.',
    organization: 'Google Brain / Research',
    pubYear: 2017,
    doi: '10.48550/arXiv.1706.03762',
    pdfUri: 'https://arxiv.org/pdf/1706.03762.pdf',
    readingProgress: 68
  },
  {
    id: 'paper-2',
    title: 'Quantum Error Correction via Surface Codes',
    domain: 'Quantum Computing',
    summary: 'Demonstrating fault-tolerant quantum memory using 2D lattice surface codes that suppress physical qubit decoherence.',
    fullExplanation: 'Surface code architectures arrange physical qubits in a two-dimensional grid, interleaving data qubits with measure qubits to detect bit-flip and phase-flip errors.',
    context: 'Environmental decoherence limits physical qubit lifetimes. Fault-tolerant memory requires error-correcting codes below threshold error rates.',
    methodology: 'Interleaved syndrome extraction measurements detect topological defect pairs without destroying stored quantum states.',
    results: 'Suppressed logical error rate exponentially with increasing lattice size, achieving 99.8% measurement fidelity.',
    futureScope: 'Scaling lattice dimensions toward 1,000 logical qubits for practical quantum chemistry simulations.',
    authorName: 'Dr. Clara Thorne',
    organization: 'MIT Quantum Lab',
    pubYear: 2026,
    doi: '10.1038/s41586-026-0012',
    pdfUri: 'file://quantum-surface-codes.pdf',
    readingProgress: 35
  },
  {
    id: 'paper-3',
    title: 'Gene Editing via CRISPR-Cas13 In-Vivo',
    domain: 'Biotechnology',
    summary: 'Targeted RNA cleavage using engineered Cas13 endonucleases to suppress viral replication pathways.',
    fullExplanation: 'CRISPR-Cas13 systems provide temporal RNA knockdown without altering underlying genomic DNA sequences.',
    context: 'Traditional Cas9 DNA editing risks permanent off-target mutations in non-dividing human tissues.',
    methodology: 'Synthetic guide RNAs target conserved viral polymerase transcripts in respiratory epithelial cells.',
    results: 'Reduced viral load by 94% in animal model trials within 48 hours of administration.',
    futureScope: 'Clinical trial evaluation for therapeutic RNA antiviral therapies.',
    authorName: 'Prof. Elena Rostova et al.',
    organization: 'Stanford Bio Engineering',
    pubYear: 2026,
    doi: '10.1038/s41587-026-0104',
    pdfUri: 'file://crispr-cas13-rna.pdf',
    readingProgress: 10
  }
];

const sampleWebMentors = [
  {
    id: 'm1',
    name: 'Dr. Aris Thorne',
    title: 'Professor of Computer Science',
    affiliation: 'MIT Artificial Intelligence Lab',
    bio: 'Pioneering research in sparse neural network optimization and decentralized deep learning.',
    hIndex: 34,
    citations: '4.8k'
  },
  {
    id: 'm2',
    name: 'Prof. Elena Rostova',
    title: 'Chair of Quantum Physics',
    affiliation: 'Stanford Quantum Institute',
    bio: 'Specializing in fault-tolerant surface code architectures and topological qubit memory.',
    hIndex: 42,
    citations: '8.2k'
  }
];

// ════════════════ INIT & PWA EVENT LISTENERS ════════════════
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initLocalStorageSync();
  renderDashboard();
  renderFeed();
  renderKnowledgeGraph();
  renderCompareTable();
  renderRoadmaps();
  renderMentors();
  setupKeyboardShortcuts();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration error:', err));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPWAInstallPrompt = e;
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'inline-flex';
  });
}

function installPWA() {
  if (deferredPWAInstallPrompt) {
    deferredPWAInstallPrompt.prompt();
    deferredPWAInstallPrompt.userChoice.then(() => {
      deferredPWAInstallPrompt = null;
      const btn = document.getElementById('pwaInstallBtn');
      if (btn) btn.style.display = 'none';
    });
  }
}

// ════════════════ REAL-TIME SYNC ENGINE ════════════════
function initLocalStorageSync() {
  if (!localStorage.getItem('shords.savedPapers')) {
    localStorage.setItem('shords.savedPapers', JSON.stringify(['paper-1']));
  }
  if (!localStorage.getItem('shords.history')) {
    localStorage.setItem('shords.history', JSON.stringify(['paper-1', 'paper-2']));
  }
}

function getSavedPaperIds() {
  return JSON.parse(localStorage.getItem('shords.savedPapers') || '[]');
}

function toggleSavePaper(id) {
  const saved = getSavedPaperIds();
  const index = saved.indexOf(id);
  if (index >= 0) saved.splice(index, 1);
  else saved.push(id);
  localStorage.setItem('shords.savedPapers', JSON.stringify(saved));
  renderDashboard();
  renderFeed();
  renderBookmarks();
}

// ════════════════ NAVIGATION ENGINE ════════════════
function switchView(viewId) {
  currentView = viewId;
  document.querySelectorAll('.os-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.s-nav-btn').forEach(b => b.classList.remove('active'));

  const viewEl = document.getElementById('view-' + viewId);
  const navBtn = document.getElementById('snav-' + viewId);

  if (viewEl) viewEl.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  if (viewId === 'bookmarks') renderBookmarks();
  if (viewId === 'history') renderHistory();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleSidebar() {
  const sidebar = document.getElementById('leftSidebar');
  sidebar.classList.toggle('collapsed');
}

// ════════════════ KEYBOARD SHORTCUTS ════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSpotlightModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.key === 'Escape') {
      closeSpotlightModal();
    }
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      toggleMiniAudio();
    }
  });
}

// ════════════════ UNIVERSAL SPOTLIGHT SEARCH (Ctrl + K) ════════════════
function openSpotlightModal() {
  const modal = document.getElementById('spotlightModal');
  const input = document.getElementById('spotlightInput');
  modal.classList.add('active');
  input.focus();
  handleSpotlightKey({ key: '' });
}

function closeSpotlightModal() {
  document.getElementById('spotlightModal').classList.remove('active');
}

function handleSpotlightKey(e) {
  const query = document.getElementById('spotlightInput').value.toLowerCase().trim();
  const container = document.getElementById('spotlightResultsContainer');

  if (!query) {
    container.innerHTML = `
      <div class="spotlight-section">
        <div class="spotlight-label">COMMAND SHORTCUTS</div>
        <div class="spotlight-item" onclick="switchView('dashboard'); closeSpotlightModal();">
          <span>🏠 Go to Home Dashboard</span><span class="kbd-badge">Dashboard</span>
        </div>
        <div class="spotlight-item" onclick="switchView('reader'); closeSpotlightModal();">
          <span>🔬 Launch 3-Column Paper Reader</span><span class="kbd-badge">Reader</span>
        </div>
        <div class="spotlight-item" onclick="switchView('compare'); closeSpotlightModal();">
          <span>📊 Open Paper Comparison Matrix</span><span class="kbd-badge">Compare</span>
        </div>
        <div class="spotlight-item" onclick="switchView('upload'); closeSpotlightModal();">
          <span>📤 Open Desktop Publishing Studio</span><span class="kbd-badge">Upload</span>
        </div>
      </div>
    `;
    return;
  }

  const matches = defaultWebPapers.filter(p =>
    p.title.toLowerCase().includes(query) ||
    p.domain.toLowerCase().includes(query) ||
    p.authorName.toLowerCase().includes(query) ||
    p.doi.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    container.innerHTML = `<div class="spotlight-empty">No manuscripts matching "${query}"</div>`;
  } else {
    container.innerHTML = matches.map(p => `
      <div class="spotlight-item" onclick="openPaperInReader('${p.id}'); closeSpotlightModal();">
        <div>
          <strong style="color:var(--text);">${p.title}</strong>
          <div style="font-size:11px; color:var(--subdued);">${p.authorName} · ${p.domain}</div>
        </div>
        <span class="open-pill">Open ↗</span>
      </div>
    `).join('');
  }
}

// ════════════════ HOME COMMAND DASHBOARD ════════════════
function renderDashboard() {
  const paper = defaultWebPapers[0];
  document.getElementById('dashContinueTitle').textContent = paper.title;
  document.getElementById('dashContinueSummary').textContent = `"${paper.summary}"`;

  const trendingList = document.getElementById('dashTrendingList');
  trendingList.innerHTML = defaultWebPapers.map(p => `
    <div class="dash-item-row" onclick="openPaperInReader('${p.id}')">
      <div>
        <strong style="color:var(--text); font-size:13px;">${p.title}</strong>
        <div style="font-size:11px; color:var(--subdued);">${p.authorName} · ${p.domain}</div>
      </div>
      <span class="badge-cyan">${p.readingProgress}% Read</span>
    </div>
  `).join('');
}

// ════════════════ DISCOVER / FEED ════════════════
function renderFeed() {
  const container = document.getElementById('webFeedContainer');
  if (!container) return;

  const saved = getSavedPaperIds();
  container.innerHTML = defaultWebPapers.map(p => {
    const isBookmark = saved.includes(p.id);
    return `
      <div class="web-paper-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="card-domain-badge">${p.domain.toUpperCase()}</span>
          <button class="bookmark-icon-btn" onclick="event.stopPropagation(); toggleSavePaper('${p.id}')">
            ${isBookmark ? '🔖' : '📑'}
          </button>
        </div>
        <h3 class="card-title" onclick="openPaperInReader('${p.id}')">${p.title}</h3>
        <p class="card-hook" onclick="openPaperInReader('${p.id}')">"${p.summary}"</p>
        <div class="card-author-row" onclick="openPaperInReader('${p.id}')">
          <span>✍️ ${p.authorName} · ${p.organization}</span>
          <span class="open-pill">Open Workspace ↗</span>
        </div>
      </div>
    `;
  }).join('');
}

// ════════════════ 3-COLUMN WORKSPACE READER ════════════════
function openPaperInReader(paperId) {
  activePaperId = paperId;
  const paper = defaultWebPapers.find(p => p.id === paperId) || defaultWebPapers[0];

  document.getElementById('readerDomainBadge').textContent = paper.domain.toUpperCase();
  document.getElementById('readerTitleHeader').textContent = paper.title;

  document.getElementById('rContextText').textContent = paper.context || paper.summary;
  document.getElementById('rMethodText').textContent = paper.methodology || paper.fullExplanation;
  document.getElementById('rResultsText').textContent = paper.results || 'Achieved high benchmark accuracy metrics.';
  document.getElementById('rScopeText').textContent = paper.futureScope || 'Extending multi-modal integration across robotics and embedded hardware.';

  switchView('reader');
}

function jumpSection(secId) {
  document.querySelectorAll('.sec-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  if (secId === 's-all') {
    document.querySelectorAll('.sec-block').forEach(b => b.style.display = 'block');
  } else {
    document.querySelectorAll('.sec-block').forEach(b => b.style.display = 'none');
    const target = document.getElementById(secId.replace('s-', 'sec-'));
    if (target) target.style.display = 'block';
  }
}

function triggerAiAction(action) {
  const paper = defaultWebPapers.find(p => p.id === activePaperId) || defaultWebPapers[0];
  const chatContainer = document.getElementById('copilotChatMessages');

  let response = '';
  if (action === 'explain') {
    response = `**Context Explanation:** ${paper.title} addresses compute execution bottlenecks by replacing sequential RNN layers with multi-head self-attention.`;
  } else if (action === 'simplify') {
    response = `**Simplified:** Instead of reading words one by one in order, this algorithm looks at all words at the same time and connects related ideas instantly.`;
  } else if (action === 'quiz') {
    response = `**Quick Quiz:** What replaces recurrent layers in the Transformer architecture?\n1. Multi-head self-attention\n2. Convolutional kernels\n3. LSTM cells`;
  } else if (action === 'debate') {
    response = `**AI Thesis Debate:** Thesis A argues matrix parallelization outweighs memory footprint; Thesis B argues memory pruning is required for edge robotics.`;
  }

  chatContainer.innerHTML += `<div class="chat-msg ai">${response}</div>`;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function sendCopilotMsg() {
  const input = document.getElementById('copilotInput');
  const text = input.value.trim();
  if (!text) return;

  const chatContainer = document.getElementById('copilotChatMessages');
  chatContainer.innerHTML += `<div class="chat-msg user">${text}</div>`;
  input.value = '';

  setTimeout(() => {
    chatContainer.innerHTML += `<div class="chat-msg ai">I analyzed your question: "${text}". Based on Section 2 of this manuscript, long-range matrix dependencies are computed concurrently via queries, keys, and values.</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }, 600);
}

function exportActiveBibtex() {
  const paper = defaultWebPapers.find(p => p.id === activePaperId) || defaultWebPapers[0];
  const citeKey = paper.authorName.split(' ')[0].toLowerCase() + paper.pubYear;
  const bib = `@article{${citeKey},
  title={${paper.title}},
  author={${paper.authorName}},
  journal={${paper.organization}},
  year={${paper.pubYear}},
  doi={${paper.doi}}
}`;
  navigator.clipboard.writeText(bib);
  alert('Copied BibTeX Citation to Clipboard!\n\n' + bib);
}

function openActiveDebate() {
  alert(`AI Scholarly Debate Simulator:\n\nSimulating thesis debate between "${defaultWebPapers[0].title}" vs "${defaultWebPapers[1].title}".`);
}

function openActiveRoadmap() {
  switchView('roadmaps');
}

function openOriginalPdf() {
  const paper = defaultWebPapers.find(p => p.id === activePaperId) || defaultWebPapers[0];
  window.open(paper.pdfUri || 'https://arxiv.org', '_blank');
}

// ════════════════ CITATION KNOWLEDGE GRAPH ════════════════
function renderKnowledgeGraph() {
  const svg = document.getElementById('knowledgeGraphSvg');
  if (!svg) return;

  svg.innerHTML = `
    <!-- Edge Lines -->
    <line x1="200" y1="150" x2="400" y2="100" stroke="rgba(6,182,212,0.3)" stroke-width="2" />
    <line x1="200" y1="150" x2="400" y2="250" stroke="rgba(6,182,212,0.3)" stroke-width="2" />
    <line x1="400" y1="100" x2="600" y2="180" stroke="rgba(139,92,246,0.3)" stroke-width="2" />

    <!-- Node 1: Primary Paper -->
    <g transform="translate(200, 150)" cursor="pointer" onclick="openPaperInReader('paper-1')">
      <circle r="36" fill="rgba(6,182,212,0.15)" stroke="#06B6D4" stroke-width="2" />
      <text y="-4" text-anchor="middle" fill="#FFFFFF" font-size="11" font-weight="800">Attention</text>
      <text y="12" text-anchor="middle" fill="#94A3B8" font-size="9">Google Brain</text>
    </g>

    <!-- Node 2: Quantum Paper -->
    <g transform="translate(400, 100)" cursor="pointer" onclick="openPaperInReader('paper-2')">
      <circle r="30" fill="rgba(139,92,246,0.15)" stroke="#8B5CF6" stroke-width="2" />
      <text y="-2" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="800">Quantum</text>
      <text y="10" text-anchor="middle" fill="#94A3B8" font-size="9">MIT Lab</text>
    </g>

    <!-- Node 3: CRISPR Paper -->
    <g transform="translate(400, 250)" cursor="pointer" onclick="openPaperInReader('paper-3')">
      <circle r="30" fill="rgba(52,211,153,0.15)" stroke="#34D399" stroke-width="2" />
      <text y="-2" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="800">CRISPR</text>
      <text y="10" text-anchor="middle" fill="#94A3B8" font-size="9">Stanford</text>
    </g>

    <!-- Node 4: Synthesis -->
    <g transform="translate(600, 180)" cursor="pointer">
      <circle r="26" fill="rgba(255,255,255,0.05)" stroke="#64748B" stroke-width="1.5" />
      <text y="4" text-anchor="middle" fill="#94A3B8" font-size="9">Crossref DOI</text>
    </g>
  `;
}

// ════════════════ PAPER COMPARISON MATRIX ════════════════
function renderCompareTable() {
  const tbody = document.getElementById('compareTableBody');
  if (!tbody) return;

  tbody.innerHTML = defaultWebPapers.map(p => `
    <tr>
      <td><strong>${p.title}</strong></td>
      <td><span class="domain-tag">${p.domain}</span></td>
      <td>${p.methodology}</td>
      <td><strong style="color:var(--primary);">99.8% Precision</strong></td>
      <td>${p.summary.slice(0, 45)}...</td>
      <td>Requires high GPU memory</td>
    </tr>
  `).join('');
}

function exportComparisonCsv() {
  let csv = 'Title,Domain,Methodology,DOI\n';
  defaultWebPapers.forEach(p => {
    csv += `"${p.title}","${p.domain}","${p.methodology}","${p.doi}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shords_paper_comparison.csv';
  a.click();
}

// ════════════════ ROADMAPS ════════════════
function renderRoadmaps() {
  const container = document.getElementById('roadmapsListContainer');
  if (!container) return;

  container.innerHTML = defaultWebPapers.map(p => `
    <div class="dash-card">
      <span class="badge-cyan">4-PHASE IMPLEMENTATION ROADMAP</span>
      <h3 style="margin:8px 0;">${p.title}</h3>
      <div class="roadmap-steps">
        <div class="r-step"><strong>Phase 1:</strong> Foundations & Linear Algebra Matrix Prep (2 Days)</div>
        <div class="r-step"><strong>Phase 2:</strong> PyTorch Pipeline Setup & Tensor Benchmarks (3 Days)</div>
        <div class="r-step"><strong>Phase 3:</strong> Multi-Head Attention Layer Tuning (1 Week)</div>
        <div class="r-step"><strong>Phase 4:</strong> Embedded Real-World Deployment (2 Weeks)</div>
      </div>
    </div>
  `).join('');
}

// ════════════════ SCHOLAR MENTORS ════════════════
function renderMentors() {
  const container = document.getElementById('mentorGridContainer');
  if (!container) return;

  container.innerHTML = sampleWebMentors.map(m => `
    <div class="web-scholar-card">
      <div class="scholar-avatar">${m.name.slice(0, 2).toUpperCase()}</div>
      <h3>${m.name}</h3>
      <p class="scholar-title">${m.title}</p>
      <p class="scholar-affil">${m.affiliation}</p>
      <div class="scholar-stats">
        <span>H-INDEX: ${m.hIndex}</span>
        <span>CITATIONS: ${m.citations}</span>
      </div>
      <p class="scholar-bio">${m.bio}</p>
      <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="alert('Requested 1-on-1 thesis consultation with ${m.name}')">Book Consultation Slot</button>
    </div>
  `).join('');
}

// ════════════════ PUBLISHING STUDIO ════════════════
function handleWebFilePick(e) {
  const file = e.target.files[0];
  if (file) {
    document.getElementById('pdfFileNameText').textContent = file.name;
    document.getElementById('uploadedPdfBadge').style.display = 'inline-flex';
    if (!document.getElementById('webUpTitle').value) {
      document.getElementById('webUpTitle').value = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    }
  }
}

function publishDesktopPaper() {
  const title = document.getElementById('webUpTitle').value.trim();
  const summary = document.getElementById('webUpSummary').value.trim();
  const domain = document.getElementById('webUpDomain').value;

  if (!title || !summary) {
    alert('Please provide manuscript title and abstract summary.');
    return;
  }

  const newP = {
    id: 'paper-' + Date.now(),
    title,
    domain,
    summary,
    fullExplanation: summary,
    context: summary,
    methodology: 'Local uploaded manuscript approach.',
    results: 'Validated metrics.',
    futureScope: 'Future extensions.',
    authorName: 'Abhinav Prakash',
    organization: 'IIIT Surat',
    pubYear: 2026,
    doi: '10.48550/arXiv.2026.99',
    pdfUri: 'file://local-manuscript.pdf',
    readingProgress: 0
  };

  defaultWebPapers.unshift(newP);
  renderFeed();
  openPaperInReader(newP.id);
  alert('Published research brief to shoRDs Web OS!');
}

// ════════════════ BOOKMARKS & HISTORY ════════════════
function renderBookmarks() {
  const savedIds = getSavedPaperIds();
  const container = document.getElementById('bookmarksContainer');
  if (!container) return;

  const matches = defaultWebPapers.filter(p => savedIds.includes(p.id));
  if (matches.length === 0) {
    container.innerHTML = '<p style="color:var(--muted); font-size:13px;">No bookmarked papers yet. Click 📑 on any paper brief to bookmark.</p>';
  } else {
    container.innerHTML = matches.map(p => `
      <div class="web-paper-card" onclick="openPaperInReader('${p.id}')">
        <span class="card-domain-badge">${p.domain}</span>
        <h3>${p.title}</h3>
        <p>${p.summary}</p>
      </div>
    `).join('');
  }
}

function renderHistory() {
  const container = document.getElementById('historyContainer');
  if (!container) return;

  container.innerHTML = defaultWebPapers.map(p => `
    <div class="dash-item-row" onclick="openPaperInReader('${p.id}')">
      <div>
        <strong>${p.title}</strong>
        <div style="font-size:11px; color:var(--subdued);">${p.authorName} · ${p.domain}</div>
      </div>
      <span style="font-size:11px; color:var(--muted);">Opened Today</span>
    </div>
  `).join('');
}

// ════════════════ FLOATING MINI AUDIO PLAYER ════════════════
function toggleMiniAudio() {
  const playBtn = document.getElementById('miniPlayBtn');
  audioIsPlaying = !audioIsPlaying;

  if (audioIsPlaying) {
    playBtn.textContent = '⏸';
    audioTimer = setInterval(() => {
      audioTimeSeconds += 1;
      if (audioTimeSeconds >= audioDurationSeconds) {
        audioTimeSeconds = 0;
        toggleMiniAudio();
      }
      updateAudioProgressUI();
    }, 1000);
  } else {
    playBtn.textContent = '▶';
    if (audioTimer) clearInterval(audioTimer);
  }
}

function cycleAudioSpeed() {
  if (audioSpeed === '1.0x') audioSpeed = '1.5x';
  else if (audioSpeed === '1.5x') audioSpeed = '2.0x';
  else audioSpeed = '1.0x';

  event.target.textContent = audioSpeed;
}

function updateAudioProgressUI() {
  const fill = document.getElementById('miniAudioFill');
  const timeText = document.getElementById('miniAudioTime');
  const pct = (audioTimeSeconds / audioDurationSeconds) * 100;
  fill.style.width = pct + '%';

  const m1 = Math.floor(audioTimeSeconds / 60);
  const s1 = Math.floor(audioTimeSeconds % 60);
  const m2 = Math.floor(audioDurationSeconds / 60);
  const s2 = Math.floor(audioDurationSeconds % 60);

  timeText.textContent = `${m1}:${s1 < 10 ? '0' : ''}${s1} / ${m2}:${s2 < 10 ? '0' : ''}${s2}`;
}
