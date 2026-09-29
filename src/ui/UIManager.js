/**
 * UIManager — State-of-the-Art Ocean Pro UI overlays & Interactive Ocean Codex Encyclopedia.
 */
import { KnowledgeBuilder } from '../intelligence/KnowledgeBuilder.js';

export class UIManager {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'ocean-ui-container';
    document.body.appendChild(this.container);

    this.codex = null;
    this.currentFocusEntity = null;
    this.currentSelectedCodexKey = 'sperm_whale.glb';
    this.currentCategoryFilter = 'all';
    this.searchQuery = '';

    this.injectStyles();
    this.initFocusCard();
    this.initDiscoveryToast();
    this.initCodexModal();
    this.initDebugOverlay();
    this.initSimulationPanel();
    this.initKeyboardShortcuts();
  }

  setCodexInstance(codex) {
    this.codex = codex;
  }

  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #ocean-ui-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 99;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #e0f2fe;
      }
      
      .ocean-panel {
        pointer-events: auto;
        background: rgba(10, 25, 41, 0.85);
        backdrop-filter: blur(18px) saturate(1.4);
        -webkit-backdrop-filter: blur(18px) saturate(1.4);
        border: 1px solid rgba(56, 189, 248, 0.28);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 12px rgba(56, 189, 248, 0.08);
        padding: 14px 18px;
        font-size: 13px;
        transition: all 0.25s ease;
      }

      /* Discovery Notification Toast */
      #codex-toast {
        position: fixed;
        top: 72px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        opacity: 0;
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 20px;
        border-radius: 30px;
        background: rgba(14, 116, 144, 0.92);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(125, 211, 252, 0.6);
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.4);
        pointer-events: auto;
        cursor: pointer;
        z-index: 105;
      }
      #codex-toast.show {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
      }

      /* In-Game Codex Telemetry Focus Card — BOTTOM-LEFT (Ocean Data owns top-left; never overlaps it, the top toolbar, or the center view) */
      #codex-focus-card {
        position: fixed;
        bottom: 20px;
        left: 20px;
        top: auto;
        /* Stay inside the bottom band the Ocean Data panel reserves for us. That
           panel is pinned top-left and its own max-height keeps its lowest edge
           ~320px above the viewport bottom, so capping this card to ~300px (plus
           its 20px offset) guarantees the two left-column surfaces can NEVER
           overlap — the Ocean Data panel is z-120 and would otherwise cover this
           z-95 Codex card (spec §2/§18). Long dossiers scroll inside this height. */
        max-height: min(300px, calc(100vh - 240px));
        overflow-y: auto;
        transform: translateY(8px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
        width: 320px;
        max-width: calc(100vw - 40px);
        background: rgba(10, 25, 41, 0.94);
        backdrop-filter: blur(20px) saturate(1.5);
        -webkit-backdrop-filter: blur(20px) saturate(1.5);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7), 0 0 24px rgba(56, 189, 248, 0.2);
        padding: 14px 18px;
        z-index: 95;
      }
      #codex-focus-card.visible {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      .focus-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 1px solid rgba(56, 189, 248, 0.2);
        padding-bottom: 8px;
        margin-bottom: 10px;
      }
      .focus-title-wrap {
        flex: 1;
      }
      #card-common-name {
        font-size: 13.5px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #f0f9ff;
        text-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
      }
      #card-scientific-name {
        font-size: 11.5px;
        font-style: italic;
        color: #7dd3fc;
        margin-top: 2px;
      }
      .card-close-btn {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #94a3b8;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
        transition: all 0.2s ease;
        margin-left: 8px;
      }
      .card-close-btn:hover {
        background: rgba(239, 68, 68, 0.8);
        border-color: #ef4444;
        color: #fff;
      }
      .focus-body {
        display: flex;
        flex-direction: column;
        gap: 5px;
        font-size: 11.5px;
      }
      .card-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .card-lbl {
        color: #94a3b8;
        font-weight: 500;
      }
      .card-val {
        color: #e2e8f0;
        text-align: right;
        font-weight: 400;
      }
      .card-fact-box {
        margin-top: 8px;
        padding: 8px 10px;
        background: rgba(14, 116, 144, 0.22);
        border-left: 3px solid #38bdf8;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1.4;
        color: #bae6fd;
      }
      .card-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(56, 189, 248, 0.15);
      }
      .card-codex-link {
        background: rgba(14, 116, 144, 0.5);
        border: 1px solid rgba(56, 189, 248, 0.4);
        color: #7dd3fc;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .card-codex-link:hover {
        background: #0284c7;
        color: #fff;
      }
      .card-footer {
        font-size: 9.5px;
        color: #64748b;
        text-align: right;
        flex: 1;
        margin-left: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Simulation Tool Bar */
      #sim-toolbar {
        position: fixed;
        top: 18px;
        right: 320px; /* Positioned right next to the Ocean lil-gui panel */
        display: flex;
        gap: 6px;
        pointer-events: auto;
        z-index: 100;
      }

      .ui-btn {
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(56, 189, 248, 0.35);
        color: #7dd3fc;
        /* Compact padding (was 7px 15px): keeps the five analysis buttons in the
           right lane so the Return-to-Globe badge on the left never overlaps them
           (§3) at ≥1366-wide desktops, while staying fully legible/clickable. */
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }
      .ui-btn:hover {
        background: rgba(56, 189, 248, 0.25);
        border-color: #38bdf8;
        color: #ffffff;
      }
      .ui-btn.active {
        background: #0284c7;
        color: #ffffff;
        border-color: #38bdf8;
        box-shadow: 0 0 14px rgba(56, 189, 248, 0.5);
      }

      /* Debug Overlay */
      #debug-overlay {
        position: fixed;
        bottom: 24px;
        left: 24px;
        font-family: monospace;
        font-size: 11px;
        line-height: 1.5;
        color: #94a3b8;
        display: none;
      }
      #debug-overlay.open {
        display: block;
      }

      /* ==========================================================
         FULL INTERACTIVE OCEAN CODEX ENCYCLOPEDIA MODAL
         ========================================================== */
      #codex-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.72);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 1000;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
      }
      #codex-modal-backdrop.open {
        display: flex;
      }

      #codex-modal {
        width: 1020px;
        max-width: 94vw;
        height: 82vh;
        max-height: 720px;
        background: rgba(10, 25, 41, 0.94);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 16px;
        box-shadow: 0 25px 65px rgba(0, 0, 0, 0.8), 0 0 35px rgba(56, 189, 248, 0.22);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* Modal Header */
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        border-bottom: 1px solid rgba(56, 189, 248, 0.2);
        background: rgba(15, 30, 50, 0.7);
      }
      .modal-title-area {
        display: flex;
        align-items: baseline;
        gap: 12px;
      }
      .modal-title {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #f0f9ff;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .modal-stats-badge {
        font-size: 12px;
        color: #7dd3fc;
        background: rgba(14, 116, 144, 0.35);
        padding: 3px 10px;
        border-radius: 12px;
        border: 1px solid rgba(56, 189, 248, 0.3);
      }
      .modal-close-btn {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #94a3b8;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
      }
      .modal-close-btn:hover {
        background: rgba(239, 68, 68, 0.85);
        border-color: #ef4444;
        color: #fff;
      }

      /* Filter & Search Bar */
      .modal-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 24px;
        border-bottom: 1px solid rgba(56, 189, 248, 0.15);
        background: rgba(8, 20, 34, 0.6);
        gap: 16px;
        flex-wrap: wrap;
      }
      .category-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .cat-tab {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(56, 189, 248, 0.2);
        color: #94a3b8;
        padding: 5px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .cat-tab:hover {
        border-color: #38bdf8;
        color: #f0f9ff;
      }
      .cat-tab.active {
        background: rgba(14, 116, 144, 0.6);
        border-color: #38bdf8;
        color: #ffffff;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
      }
      .search-box {
        position: relative;
        min-width: 240px;
      }
      .search-input {
        width: 100%;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 8px;
        padding: 6px 12px 6px 30px;
        font-size: 12px;
        color: #e0f2fe;
        outline: none;
        transition: border-color 0.2s;
      }
      .search-input:focus {
        border-color: #38bdf8;
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
      }
      .search-icon {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 12px;
        color: #64748b;
        pointer-events: none;
      }

      /* Modal Content Split: Directory List + Dossier */
      .modal-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      /* Left: Species Directory List */
      .species-directory {
        width: 360px;
        border-right: 1px solid rgba(56, 189, 248, 0.15);
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(6, 15, 26, 0.4);
      }
      .species-directory::-webkit-scrollbar {
        width: 6px;
      }
      .species-directory::-webkit-scrollbar-thumb {
        background: rgba(56, 189, 248, 0.25);
        border-radius: 3px;
      }

      .dir-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: rgba(15, 23, 42, 0.45);
        border: 1px solid rgba(56, 189, 248, 0.12);
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .dir-item:hover {
        background: rgba(14, 116, 144, 0.25);
        border-color: rgba(56, 189, 248, 0.35);
        transform: translateX(2px);
      }
      .dir-item.active {
        background: rgba(14, 116, 144, 0.45);
        border-color: #38bdf8;
        box-shadow: inset 0 0 12px rgba(56, 189, 248, 0.2), 0 0 12px rgba(56, 189, 248, 0.15);
      }
      .dir-icon {
        font-size: 24px;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(8, 20, 34, 0.6);
        border-radius: 8px;
        border: 1px solid rgba(56, 189, 248, 0.2);
        flex-shrink: 0;
      }
      .dir-meta {
        flex: 1;
        min-width: 0;
      }
      .dir-name {
        font-weight: 600;
        font-size: 13px;
        color: #f0f9ff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dir-sci {
        font-size: 11px;
        font-style: italic;
        color: #7dd3fc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dir-badge {
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 10px;
        white-space: nowrap;
        font-weight: 500;
      }
      .badge-discovered {
        background: rgba(34, 197, 94, 0.2);
        border: 1px solid rgba(34, 197, 94, 0.4);
        color: #86efac;
      }
      .badge-cataloged {
        background: rgba(148, 163, 184, 0.15);
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: #94a3b8;
      }

      /* Right: Full Biological Dossier */
      .species-dossier {
        flex: 1;
        overflow-y: auto;
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .species-dossier::-webkit-scrollbar {
        width: 6px;
      }
      .species-dossier::-webkit-scrollbar-thumb {
        background: rgba(56, 189, 248, 0.25);
        border-radius: 3px;
      }

      .dossier-hero {
        display: flex;
        align-items: center;
        gap: 18px;
        border-bottom: 1px solid rgba(56, 189, 248, 0.2);
        padding-bottom: 16px;
      }
      .dossier-hero-icon {
        font-size: 42px;
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(14, 116, 144, 0.25);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 16px;
        box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
        flex-shrink: 0;
      }
      .dossier-hero-title {
        font-size: 22px;
        font-weight: 700;
        color: #f0f9ff;
        letter-spacing: 0.03em;
        text-shadow: 0 0 14px rgba(56, 189, 248, 0.35);
      }
      .dossier-hero-sci {
        font-size: 14px;
        font-style: italic;
        color: #38bdf8;
        margin-top: 4px;
      }

      /* Taxonomy Pill Chain */
      .dossier-taxonomy {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .tax-pill {
        font-size: 11px;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(56, 189, 248, 0.25);
        padding: 3px 8px;
        border-radius: 6px;
        color: #94a3b8;
      }
      .tax-pill span {
        color: #e0f2fe;
        font-weight: 600;
      }

      /* Dossier Attribute Grid */
      .dossier-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }
      .dossier-attr {
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(56, 189, 248, 0.15);
        border-radius: 10px;
        padding: 10px 14px;
      }
      .attr-title {
        font-size: 11px;
        color: #94a3b8;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }
      .attr-val {
        font-size: 13px;
        color: #f0f9ff;
        font-weight: 500;
        line-height: 1.35;
      }

      /* Spotlight Fact Box */
      .dossier-fact-card {
        background: linear-gradient(135deg, rgba(14, 116, 144, 0.3) 0%, rgba(15, 23, 42, 0.6) 100%);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-left: 4px solid #38bdf8;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }
      .fact-card-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #38bdf8;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fact-card-body {
        font-size: 13px;
        line-height: 1.5;
        color: #e0f2fe;
      }

      /* Habitat & Role */
      .dossier-section-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
        margin-bottom: 6px;
      }
      .dossier-section-text {
        font-size: 12.5px;
        line-height: 1.45;
        color: #cbd5e1;
      }

      .dossier-sources {
        margin-top: auto;
        padding-top: 14px;
        border-top: 1px solid rgba(56, 189, 248, 0.15);
        font-size: 11px;
        color: #64748b;
      }
      .dossier-sources span {
        color: #7dd3fc;
      }
    `;
    document.head.appendChild(style);
  }

  initFocusCard() {
    this.focusCard = document.createElement('div');
    this.focusCard.id = 'codex-focus-card';
    this.focusCard.innerHTML = `
      <div class="focus-header">
        <div class="focus-title-wrap">
          <div id="card-common-name">IDENTIFYING TARGET</div>
          <div id="card-scientific-name"></div>
        </div>
        <button id="card-close-btn" class="card-close-btn" title="Dismiss inspection">✕</button>
      </div>
      <div id="card-body" class="focus-body"></div>
      <div class="card-actions">
        <button id="card-open-codex-btn" class="card-codex-link">📖 View in Codex</button>
        <div id="card-footer" class="card-footer">WoRMS Intelligence</div>
      </div>
    `;
    this.container.appendChild(this.focusCard);

    // Wire close button
    this.focusCard.querySelector('#card-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideFocusCard();
      if (this.currentFocusEntity && this.codex) {
        const key = this.currentFocusEntity.name || this.currentFocusEntity.id;
        this.codex.dismissTarget(key);
      }
    });

    // Wire view in codex button
    this.focusCard.querySelector('#card-open-codex-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const key = this.currentFocusKey || 'sperm_whale.glb';
      this.openCodexModal(key);
    });
  }

  initDiscoveryToast() {
    this.toast = document.createElement('div');
    this.toast.id = 'codex-toast';
    this.toast.innerHTML = `
      <span style="font-size: 20px;">📖</span>
      <div>
        <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #bae6fd;">Codex Discovery</div>
        <div id="toast-title" style="font-weight: 600; color: #fff; font-size: 12.5px;">Species Name</div>
      </div>
    `;
    this.container.appendChild(this.toast);

    this.toast.addEventListener('click', () => {
      this.openCodexModal();
    });
  }

  initCodexModal() {
    this.codexBackdrop = document.createElement('div');
    this.codexBackdrop.id = 'codex-modal-backdrop';
    this.codexBackdrop.innerHTML = `
      <div id="codex-modal">
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-title-area">
            <div class="modal-title">📖 OCEAN CODEX — MARINE ENCYCLOPEDIA</div>
            <div id="codex-stat-discovered" class="modal-stats-badge">0 / 42 Discovered</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="modal-admin-btn" class="modal-close-btn" style="width:auto;padding:4px 10px;font-size:11px;border-radius:4px;font-weight:600;letter-spacing:0.04em;" title="Admin Research & Add">🔬 Admin: Add Species</button>
            <button id="modal-close-x" class="modal-close-btn" title="Close Codex (ESC)">✕</button>
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="modal-toolbar">
          <div class="category-tabs">
            <button class="cat-tab active" data-cat="all">🌊 All</button>
            <button class="cat-tab" data-cat="megafauna">🐋 Megafauna</button>
            <button class="cat-tab" data-cat="fish">🐠 Reef & Pelagic</button>
            <button class="cat-tab" data-cat="invertebrate">🪼 Jellies & Octopus</button>
            <button class="cat-tab" data-cat="benthic">🪸 Benthic Habitat</button>
            <button class="cat-tab" data-cat="instrument">📡 Ocean Tech</button>
          </div>
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input id="codex-search-input" type="text" class="search-input" placeholder="Search species, depth, diet..." />
          </div>
        </div>

        <!-- Split View: Directory & Dossier -->
        <div class="modal-body">
          <div id="codex-species-list" class="species-directory"></div>
          <div id="codex-dossier-view" class="species-dossier"></div>
        </div>
      </div>
    `;
    this.container.appendChild(this.codexBackdrop);

    // Close handlers
    this.codexBackdrop.querySelector('#modal-close-x').addEventListener('click', () => {
      this.closeCodexModal();
    });
    this.codexBackdrop.addEventListener('click', (e) => {
      if (e.target === this.codexBackdrop) this.closeCodexModal();
    });

    // Admin Research & Add
    const adminBtn = this.codexBackdrop.querySelector('#modal-admin-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', async () => {
        const query = window.prompt('Admin Research & Add:\nEnter species common name or asset filename to research and persist (e.g. "barracuda.glb" or "Tiger Shark"):');
        if (!query || !query.trim()) return;
        const target = query.trim();
        adminBtn.disabled = true;
        adminBtn.textContent = '⏳ Researching...';
        try {
          const res = await KnowledgeBuilder.researchAndPersistAdmin(target);
          if (res) {
            window.alert(`Successfully researched and persisted ${res.identity?.commonName || target} to Marine Knowledge!`);
            this.currentSelectedCodexKey = target;
            this.renderCodexDirectory();
          } else {
            window.alert(`Could not resolve biology for "${target}".`);
          }
        } catch (e) {
          window.alert(`Error researching species: ${e.message || e}`);
        } finally {
          adminBtn.disabled = false;
          adminBtn.textContent = '🔬 Admin: Add Species';
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.OceanCodexAdmin = {
        researchAndAdd: (name) => KnowledgeBuilder.researchAndPersistAdmin(name)
      };
    }

    // Category Tabs
    const tabs = this.codexBackdrop.querySelectorAll('.cat-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentCategoryFilter = tab.dataset.cat;
        this.renderCodexDirectory();
      });
    });

    // Search Input
    const searchInput = this.codexBackdrop.querySelector('#codex-search-input');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderCodexDirectory();
    });
  }

  initSimulationPanel() {
    this.simBar = document.createElement('div');
    this.simBar.id = 'sim-toolbar';
    this.simBar.innerHTML = `
      <button id="btn-codex" class="ui-btn">📖 Codex</button>
      <button id="btn-pfz" class="ui-btn">🐟 PFZ Advisory</button>
      <button id="btn-sar" class="ui-btn">🧭 SAR Drift</button>
      <button id="btn-features" class="ui-btn">🌀 Eddies/AI</button>
      <button id="btn-debug" class="ui-btn">📊 Stats</button>
    `;
    this.container.appendChild(this.simBar);

    // Event listeners
    this.simBar.querySelector('#btn-codex').onclick = () => {
      this.toggleCodexModal();
    };
    this.simBar.querySelector('#btn-debug').onclick = () => {
      this.debugOverlay.classList.toggle('open');
      this.simBar.querySelector('#btn-debug').classList.toggle('active');
    };
  }

  initDebugOverlay() {
    this.debugOverlay = document.createElement('div');
    this.debugOverlay.id = 'debug-overlay';
    this.debugOverlay.className = 'ocean-panel';
    this.debugOverlay.innerHTML = `
      <div style="color: #38bdf8; font-weight: bold; margin-bottom: 4px;">SYSTEM METRICS</div>
      <div>FPS: <span id="dbg-fps">--</span></div>
      <div>Creatures: <span id="dbg-creatures">--</span></div>
      <div>Schools: <span id="dbg-schools">--</span></div>
      <div>Argo Floats: <span id="dbg-argo">--</span></div>
      <div>Gliders: <span id="dbg-gliders">--</span></div>
      <div>Camera Depth: <span id="dbg-depth">--</span></div>
      <div>Ecosystem AI: <span id="dbg-eco">Active</span></div>
    `;
    this.container.appendChild(this.debugOverlay);
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.codexBackdrop.classList.contains('open')) {
          this.closeCodexModal();
        } else if (this.focusCard.classList.contains('visible')) {
          this.hideFocusCard();
        }
      }
    });
  }

  // ==========================================================
  // CODEX MODAL RENDERING & INTERACTION
  // ==========================================================

  openCodexModal(targetKey = null) {
    this.hideFocusCard();
    this.codexBackdrop.classList.add('open');
    this.simBar.querySelector('#btn-codex')?.classList.add('active');
    // Fresh lazy-resolve budget per modal session: any entry still "Resolving…" gets
    // one on-demand real resolve attempt when its dossier is viewed (see renderDossier).
    this._dossierResolveTried = new Set();

    if (targetKey) {
      this.currentSelectedCodexKey = targetKey;
    }

    this.renderCodexDirectory();
  }

  closeCodexModal() {
    this.codexBackdrop.classList.remove('open');
    this.simBar.querySelector('#btn-codex')?.classList.remove('active');
  }

  toggleCodexModal() {
    if (this.codexBackdrop.classList.contains('open')) {
      this.closeCodexModal();
    } else {
      this.openCodexModal();
    }
  }

  renderCodexDirectory() {
    const listEl = document.getElementById('codex-species-list');
    const countEl = document.getElementById('codex-stat-discovered');
    if (!listEl) return;

    listEl.innerHTML = '';

    const allEntries = this.codex ? this.codex.getEncyclopediaEntries() : [];
    let discoveredCount = 0;

    // Filter items
    const filtered = allEntries.filter(item => {
      if (item.isDiscovered) discoveredCount++;

      // Category filter
      if (this.currentCategoryFilter !== 'all' && item.category !== this.currentCategoryFilter) {
        return false;
      }

      // Search filter
      if (this.searchQuery) {
        const query = this.searchQuery;
        const text = `${item.commonName} ${item.scientificName} ${item.depth} ${item.diet} ${item.taxonomy?.className || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    });

    if (countEl) {
      countEl.textContent = `🌊 ${discoveredCount} / ${allEntries.length} Discovered in Ocean`;
    }

    // Populate List
    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 24px 12px; color: #64748b; font-size: 12px;">No matching marine entities found</div>`;
      return;
    }

    // Make sure we have a valid selection
    if (!filtered.some(f => f.key === this.currentSelectedCodexKey)) {
      this.currentSelectedCodexKey = filtered[0].key;
    }

    filtered.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = `dir-item ${item.key === this.currentSelectedCodexKey ? 'active' : ''}`;
      itemEl.innerHTML = `
        <div class="dir-icon">${item.icon || '🐟'}</div>
        <div class="dir-meta">
          <div class="dir-name">${item.commonName}</div>
          <div class="dir-sci">${item.scientificName}</div>
        </div>
        <span class="dir-badge ${item.isDiscovered ? 'badge-discovered' : 'badge-cataloged'}">
          ${item.isDiscovered ? '✅ Discovered' : '🌊 Known'}
        </span>
      `;

      itemEl.addEventListener('click', () => {
        this.currentSelectedCodexKey = item.key;
        this.codexBackdrop.querySelectorAll('.dir-item').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        this.renderDossier(item);
      });

      listEl.appendChild(itemEl);
    });

    // Render active dossier
    const activeData = filtered.find(f => f.key === this.currentSelectedCodexKey) || filtered[0];
    if (activeData) {
      this.renderDossier(activeData);
    }
  }

  renderDossier(data) {
    const dossierEl = document.getElementById('codex-dossier-view');
    if (!dossierEl) return;

    const tax = data.taxonomy || {};
    const isTech = data.category === 'instrument';
    const isVessel = data.category === 'vessel';
    const isResolved = !!data.isResolved;
    const resStatus = data.resolutionStatus || (isResolved ? 'RESOLVED' : (!data.scientificName ? 'PENDING' : 'SPECIES NOT RESOLVED'));
    const na = 'Not available';

    // Build taxonomy pill chain: Kingdom → Phylum → Class → Order → Family → Genus → Species
    const taxPillDefs = [
      ['Kingdom', tax.kingdom],
      ['Phylum',  tax.phylum],
      ['Class',   tax.className],
      ['Order',   tax.order],
      ['Family',  tax.family],
      ['Genus',   tax.genus],
      ['Species', tax.species],
    ];
    const taxPills = taxPillDefs
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class="tax-pill">${k}: <span>${v}</span></span>`)
      .join('');

    // Resolution status badge — deterministic four-state label
    const badgeStyle = {
      'RESOLVED':          'background:rgba(34,197,94,0.18);border:1px solid rgba(34,197,94,0.45);color:#86efac;',
      'PARTIALLY RESOLVED':'background:rgba(234,179,8,0.18);border:1px solid rgba(234,179,8,0.45);color:#fde047;',
      'SPECIES NOT RESOLVED':'background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.3);color:#94a3b8;',
      'PENDING':           'background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.35);color:#7dd3fc;',
    }[resStatus] || 'background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.3);color:#94a3b8;';
    const statusBadge = (isTech || isVessel) ? '' :
      `<span style="display:inline-block;margin-top:6px;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:600;letter-spacing:0.05em;${badgeStyle}">${resStatus}</span>`;

    // Lazy resolve: a biological entry with no verified identity yet (never approached
    // in-world, so absent from the cache) is resolved on demand through the real pipeline,
    // then this dossier re-renders with the result. Once per key per session — no loop, no fabrication.
    if (!this._dossierResolveTried) this._dossierResolveTried = new Set();
    if (!isTech && !isVessel && !isResolved && this.codex && data.key && !this._dossierResolveTried.has(data.key)) {
      this._dossierResolveTried.add(data.key);
      this.codex.resolveForEncyclopedia(data.key).then((fresh) => {
        if (fresh && this.codexBackdrop?.classList.contains('open')
            && this.currentSelectedCodexKey === data.key) {
          this.renderDossier(fresh);
        }
      }).catch(() => {});
    }

    // Wikipedia link — only on a verified scientific name or verified higher rank
    const wikiName = (data.scientificName && !this._isPlaceholderTaxon(data.scientificName)
      && !/^[—–-]$/.test(String(data.scientificName).trim()))
      ? data.scientificName
      : (tax.genus || tax.family || tax.className || null);
    const wikiBtnHtml = this._wikiButtonHtml(wikiName, false);

    const sciDisplay = data.scientificName || (tax.genus ? `${tax.genus} sp.` : (tax.family || null));
    const heroHtml = `
      <div class="dossier-hero">
        <div class="dossier-hero-icon">${data.icon || (isVessel ? '🚢' : '🐟')}</div>
        <div>
          <div class="dossier-hero-title">${data.commonName}</div>
          ${sciDisplay ? `<div class="dossier-hero-sci">${sciDisplay}</div>` : ''}
          ${statusBadge}
          <div class="dossier-taxonomy" style="margin-top:6px;">${taxPills}</div>
          ${wikiBtnHtml}
        </div>
      </div>`;

    // ── VESSEL / INSTRUMENT: short dedicated block, no biology fields ──────────
    if (isVessel) {
      const v = data.vesselSpec || {};
      dossierEl.innerHTML = `
        ${heroHtml}
        <div class="dossier-grid">
          ${v.type || data.taxonomy?.species ? `<div class="dossier-attr"><div class="attr-title">🚢 Type</div><div class="attr-val">${v.type || data.taxonomy?.species || na}</div></div>` : ''}
          ${v.category ? `<div class="dossier-attr"><div class="attr-title">📂 Category</div><div class="attr-val">${v.category}</div></div>` : ''}
          ${v.status ? `<div class="dossier-attr"><div class="attr-title">📡 Status</div><div class="attr-val">${v.status}</div></div>` : ''}
        </div>
        ${data.interestingFact ? `<div class="dossier-fact-card"><div class="fact-card-title">💡 Fact</div><div class="fact-card-body">${data.interestingFact}</div></div>` : ''}
        <div class="dossier-sources">
          ${(data.sources && data.sources.length) ? `Sources: <span>${data.sources.join(' · ')}</span>` : '<span style="color:#94a3b8;">Simulation entity — no external source.</span>'}
        </div>
      `;
      return;
    }

    if (isTech) {
      // Instrument: show telemetry-like block (mission, status, fact)
      dossierEl.innerHTML = `
        ${heroHtml}
        ${data.interestingFact ? `<div class="dossier-fact-card"><div class="fact-card-title">💡 Did You Know?</div><div class="fact-card-body">${data.interestingFact}</div></div>` : ''}
        <div class="dossier-sources">
          ${(data.sources && data.sources.length) ? `Sources: <span>${data.sources.join(' · ')}</span>` : ''}
        </div>
      `;
      return;
    }

    // ── BIOLOGICAL ORGANISMS ─────────────────────────────────────────────────
    // Unresolved / PENDING: honest status only, no fabricated biology
    if (!isResolved) {
      const isPending = resStatus === 'PENDING';
      const note = isPending
        ? 'Identifying this organism from authoritative sources (WoRMS · research)…'
        : 'Species not resolved. The name above is an asset label, not a verified scientific identification. No authoritative biological record is available to display.';
      dossierEl.innerHTML = `
        ${heroHtml}
        <div class="dossier-section-text" style="color:#94a3b8;font-style:italic;margin-top:10px;">${note}</div>
      `;
      return;
    }

    // RESOLVED or PARTIALLY RESOLVED — full structured field set
    dossierEl.innerHTML = `
      ${heroHtml}

      <!-- Full Taxonomy Grid -->
      <div>
        <div class="dossier-section-title">Classification</div>
        <div class="dossier-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">
          ${[['Kingdom',tax.kingdom],['Phylum',tax.phylum],['Class',tax.className],
             ['Order',tax.order],['Family',tax.family],['Genus',tax.genus],['Species',tax.species]]
            .map(([k,v]) => `<div class="dossier-attr" style="padding:7px 10px;"><div class="attr-title" style="font-size:10px;">${k}</div><div class="attr-val" style="font-size:12px;">${v || na}</div></div>`)
            .join('')}
        </div>
      </div>

      <!-- Ecology & Biology Grid -->
      <div>
        <div class="dossier-section-title">Biology &amp; Ecology</div>
        <div class="dossier-grid">
          <div class="dossier-attr"><div class="attr-title">🏊 Depth Range</div><div class="attr-val">${data.depth || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">📏 Size</div><div class="attr-val">${data.size || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">🍴 Diet</div><div class="attr-val">${data.diet || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">🌍 Habitat</div><div class="attr-val">${data.habitat || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">🗺️ Distribution</div><div class="attr-val">${data.distribution || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">⚡ Locomotion</div><div class="attr-val">${data.locomotion || na}</div></div>
          <div class="dossier-attr"><div class="attr-title">👥 Social</div><div class="attr-val">${data.social || na}</div></div>
          ${data.activity ? `<div class="dossier-attr"><div class="attr-title">🕒 Activity</div><div class="attr-val">${data.activity}</div></div>` : ''}
          ${data.verticalMovement ? `<div class="dossier-attr"><div class="attr-title">↕️ Vertical</div><div class="attr-val">${data.verticalMovement}</div></div>` : ''}
          <div class="dossier-attr"><div class="attr-title">🛡️ Conservation</div><div class="attr-val">${data.conservationStatus || 'Not assessed'}</div></div>
          ${data.reproduction ? `<div class="dossier-attr"><div class="attr-title">🥚 Reproduction</div><div class="attr-val">${data.reproduction}</div></div>` : ''}
        </div>
      </div>

      ${data.interestingFact ? `
      <div class="dossier-fact-card">
        <div class="fact-card-title">💡 Did You Know?</div>
        <div class="fact-card-body">${data.interestingFact}</div>
      </div>` : ''}

      <!-- Sources — only real ones; never a fabricated default attribution -->
      <div class="dossier-sources">
        ${(data.sources && data.sources.length)
          ? `Verified by: <span>${data.sources.join(' · ')}</span>`
          : `<span style="color:#94a3b8;">No authoritative source resolved yet.</span>`}
      </div>
    `;
  }

  // ==========================================================
  // TOP-CENTER IN-GAME FOCUS CARD
  // ==========================================================

  /**
   * True when a taxon string is a non-scientific PLACEHOLDER — the unresolved
   * sentinel ("Species Not Resolved"), an "identifying/resolving" status, or a
   * generic "unknown"/"target". These must never be shown as if they were a real
   * classification or scientific name (spec §4 — don't pretend an unresolved
   * label is an identification).
   */
  _isPlaceholderTaxon(s) {
    if (!s) return true;
    const t = String(s).toLowerCase();
    return t.includes('not resolved') || t.includes('resolving')
      || t.includes('identifying') || t === 'unknown' || t === 'target';
  }

  /**
   * Build a Wikipedia URL from a VERIFIED taxon name (species binomial, genus, or
   * family). A verified name maps 1:1 to the canonical en.wikipedia article title, so
   * we link directly. Anything that is a placeholder/sentinel/"—" yields null (no
   * button, so an unresolved organism never gets a misleading link); a name that isn't
   * a clean Latin-style token falls back to a Wikipedia SEARCH so we never deep-link to
   * the wrong species. Always URL-encoded; never invents a page title (spec Part 2).
   */
  _wikipediaUrl(name) {
    if (!name) return null;
    const clean = String(name).trim();
    if (!clean || this._isPlaceholderTaxon(clean) || /^[—–-]$/.test(clean)) return null;
    // Species binomial / genus / family: letters, spaces, periods, hyphens, accents.
    if (/^[A-Z][A-Za-z.À-ſ \-]+$/.test(clean)) {
      return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_'))}`;
    }
    return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(clean)}`;
  }

  /**
   * "View on Wikipedia" anchor for a verified identity — opens in a NEW tab (a plain
   * anchor, so no popup-blocker issue and Ocean Pro stays open). Returns '' when there
   * is no verified name, so the button simply doesn't appear for unresolved organisms.
   * `dark` tunes the palette for the in-world focus card vs the encyclopedia dossier.
   */
  _wikiButtonHtml(name, dark = false) {
    const url = this._wikipediaUrl(name);
    if (!url) return '';
    const base = 'display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-decoration:none;';
    const skin = dark
      ? 'color:#9be7ff;background:rgba(56,182,255,0.12);border:1px solid rgba(120,220,255,0.4);'
      : 'color:#0b2a3a;background:linear-gradient(90deg,#38b6ff,#9be7ff);box-shadow:0 4px 14px rgba(56,182,255,0.3);';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="${base}${skin}">🔗 View on Wikipedia</a>`;
  }

  showFocusCard(profile, entity, distance) {
    if (!profile || !profile.identity) return;
    if (this.codexBackdrop && this.codexBackdrop.classList.contains('open')) return;
    this.currentFocusEntity = entity;
    this.currentFocusKey = entity?.name || entity?.id || profile.identity.commonName;

    const nameEl = document.getElementById('card-common-name');
    const sciEl  = document.getElementById('card-scientific-name');
    const bodyEl = document.getElementById('card-body');
    const footEl = document.getElementById('card-footer');

    const id   = profile.identity;
    const meta = profile._meta || {};
    const isInstrument = !!profile.telemetry;
    const tax  = profile.classification || {};
    const hasRealTaxon = !!(tax.className || tax.class || tax.family || tax.genus);

    // Resolution states:
    //   pending            — _meta.isLoaded === false (immediate placeholder, research in-flight)
    //   vessel             — simulation entity with vessel block, no biology
    //   unresolved         — research done, no authoritative match; never fabricate an ID
    //   partially resolved — higher-rank taxon verified, exact species unresolved
    //   resolved           — full verified species profile
    const isPending = !isInstrument && meta.isLoaded === false;
    const isVessel = !isInstrument && !isPending && !!(meta.isVessel || profile.vessel);
    const isUnresolved = !isInstrument && !isPending && !isVessel
      && !id.scientificName && !hasRealTaxon
      && (meta.source === 'unresolved' || this._isPlaceholderTaxon(id.taxon));
    const isPartiallyResolved = !isInstrument && !isPending && !isVessel && !isUnresolved
      && (!id.scientificName && hasRealTaxon);
    const isResolved = !isInstrument && !isPending && !isVessel && !isUnresolved && !isPartiallyResolved;

    // ── 5-second pending timeout ────────────────────────────────────────────
    // If the profile is still pending after 5 s, reshow with isLoaded=true so
    // the card reaches a deterministic terminal state (SPECIES NOT RESOLVED)
    // rather than looping on "Resolving species…" forever.
    if (isPending) {
      if (!this._pendingTimers) this._pendingTimers = new Map();
      const fkey = entity?.name || entity?.id || id.commonName;
      if (!this._pendingTimers.has(fkey)) {
        const t = setTimeout(() => {
          this._pendingTimers.delete(fkey);
          // Only override if the card is still showing the same entity
          if (this.currentFocusKey === fkey && this.focusCard?.classList.contains('visible')) {
            const terminal = {
              ...profile,
              _meta: { ...(profile._meta || {}), isLoaded: true, source: 'unresolved' },
            };
            this.showFocusCard(terminal, entity, distance);
          }
        }, 5000);
        this._pendingTimers.set(fkey, t);
      }
    } else {
      // Clear any pending timer when we arrive at a resolved / unresolved state
      if (this._pendingTimers) {
        const fkey = entity?.name || entity?.id || id.commonName;
        const t = this._pendingTimers.get(fkey);
        if (t) { clearTimeout(t); this._pendingTimers.delete(fkey); }
      }
    }

    if (nameEl) nameEl.textContent = isVessel ? (id.commonName || 'InVictus') : (id.commonName || 'Target').toUpperCase();

    if (sciEl) {
      sciEl.style.fontStyle = 'normal';
      if (isVessel) {
        // Show vessel type (e.g. "Container Ship") in the subtitle slot
        const vtype = profile.vessel?.type || id.taxon || 'Container Ship';
        sciEl.textContent = vtype;
        sciEl.style.display = 'block';
        sciEl.style.color = '#7dd3fc';
        sciEl.style.fontStyle = 'normal';
      } else if (id.scientificName) {
        sciEl.textContent = id.scientificName;
        sciEl.style.display = 'block';
        sciEl.style.color = '#7dd3fc';
      } else if (id.taxon && !isInstrument && !this._isPlaceholderTaxon(id.taxon)) {
        // Real higher-rank identity (ambiguous match resolved to family/genus only)
        sciEl.textContent = id.taxon;
        sciEl.style.display = 'block';
        sciEl.style.color = '#7dd3fc';
      } else if (isPending) {
        sciEl.textContent = 'Identifying species…';
        sciEl.style.display = 'block';
        sciEl.style.color = '#94a3b8';
        sciEl.style.fontStyle = 'italic';
      } else if (isUnresolved) {
        sciEl.textContent = 'Species not resolved';
        sciEl.style.display = 'block';
        sciEl.style.color = '#94a3b8';
        sciEl.style.fontStyle = 'italic';
      } else {
        sciEl.style.display = 'none';
      }
    }

    if (bodyEl) {
      if (isInstrument) {
        // Physical oceanographic instrument
        const t = profile.telemetry;
        let html = '';
        if (t.status)      html += `<div class="card-row"><span class="card-lbl">Status:</span><span class="card-val">${t.status}</span></div>`;
        if (t.depth)       html += `<div class="card-row"><span class="card-lbl">Live Depth:</span><span class="card-val">${t.depth}</span></div>`;
        if (t.temperature) html += `<div class="card-row"><span class="card-lbl">Water Temp:</span><span class="card-val">${t.temperature}</span></div>`;
        if (t.mission)     html += `<div class="card-row"><span class="card-lbl">Mission:</span><span class="card-val">${t.mission}</span></div>`;
        if (profile.interestingFact) html += `<div class="card-fact-box"><span style="font-weight:600;color:#38bdf8;">💡 Fact: </span>${profile.interestingFact}</div>`;
        bodyEl.innerHTML = html;

      } else if (isPending) {
        bodyEl.innerHTML = `<div class="card-row"><span class="card-val" style="color:#7dd3fc;font-style:italic">Identifying from authoritative sources (WoRMS · research)…</span></div>`;

      } else if (isUnresolved) {
        let html = '';
        html += `<div class="card-row"><span class="card-lbl">Status:</span><span class="card-val" style="color:#f87171;font-weight:600;">SPECIES NOT RESOLVED</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Scientific Name:</span><span class="card-val">Not available</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Taxonomy:</span><span class="card-val">Not available</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Depth Range:</span><span class="card-val">Not available</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Fact:</span><span class="card-val">Not available</span></div>`;
        html += `<div style="margin-top:6px;font-size:10.5px;color:#94a3b8;font-style:italic;">Asset label only — no verified scientific identification available.</div>`;
        bodyEl.innerHTML = html;

      } else if (isVessel) {
        // Surface vessel: Name / Type / Category / Status / Fact only — never biology
        const v = profile.vessel || {};
        let html = '';
        html += `<div class="card-row"><span class="card-lbl">Name:</span><span class="card-val">${id.commonName || 'InVictus'}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Type:</span><span class="card-val">${v.type || 'Container Ship'}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Category:</span><span class="card-val">${v.category || 'Commercial maritime surface vessel'}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Status:</span><span class="card-val">${v.status || 'Active · Simulation entity'}</span></div>`;
        if (profile.interestingFact) html += `<div class="card-fact-box"><span style="font-weight:600;color:#38bdf8;">💡 Fact: </span>${profile.interestingFact}</div>`;
        bodyEl.innerHTML = html;

      } else {
        // Resolved or partially resolved biological organism
        const eco   = profile.ecology   || {};
        const behav = profile.behavior  || {};
        const morph = profile.morphology || {};
        const na = 'Not available';
        const cls = tax.className || tax.class || null;

        let html = '';
        if (isPartiallyResolved) {
          html += `<div class="card-row"><span class="card-lbl">Status:</span><span class="card-val" style="color:#fde047;font-weight:600;">PARTIALLY RESOLVED</span></div>`;
        } else {
          html += `<div class="card-row"><span class="card-lbl">Status:</span><span class="card-val" style="color:#4ade80;font-weight:600;">RESOLVED</span></div>`;
        }
        if (id.scientificName) {
          html += `<div class="card-row"><span class="card-lbl">Scientific Name:</span><span class="card-val" style="font-style:italic;color:#7dd3fc;">${id.scientificName}</span></div>`;
        }
        // Taxonomy chain
        if (tax.kingdom) html += `<div class="card-row"><span class="card-lbl">Kingdom:</span><span class="card-val">${tax.kingdom}</span></div>`;
        if (tax.phylum)  html += `<div class="card-row"><span class="card-lbl">Phylum:</span><span class="card-val">${tax.phylum}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Class:</span><span class="card-val">${cls || na}</span></div>`;
        if (tax.order)   html += `<div class="card-row"><span class="card-lbl">Order:</span><span class="card-val">${tax.order}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Family:</span><span class="card-val">${tax.family || na}</span></div>`;
        html += `<div class="card-row"><span class="card-lbl">Genus:</span><span class="card-val">${tax.genus || na}</span></div>`;
        if (id.scientificName) html += `<div class="card-row"><span class="card-lbl">Species:</span><span class="card-val" style="font-style:italic">${id.scientificName}</span></div>`;
        
        // Ecology — ONLY show verified depth (never display simulation fallback)
        if (morph.size) html += `<div class="card-row"><span class="card-lbl">Size:</span><span class="card-val">${morph.size}</span></div>`;
        const hasVerifiedDepth = eco.depth && (!profile.depthEnvelope || !profile.depthEnvelope.isFallback);
        html += `<div class="card-row"><span class="card-lbl">Depth Range:</span><span class="card-val">${hasVerifiedDepth ? eco.depth : na}</span></div>`;
        if (eco.habitat)       html += `<div class="card-row"><span class="card-lbl">Habitat:</span><span class="card-val">${eco.habitat}</span></div>`;
        if (eco.distribution)  html += `<div class="card-row"><span class="card-lbl">Distribution:</span><span class="card-val">${eco.distribution}</span></div>`;
        if (eco.diet)          html += `<div class="card-row"><span class="card-lbl">Diet:</span><span class="card-val">${eco.diet}</span></div>`;
        
        // Behavior
        if (behav.movement)    html += `<div class="card-row"><span class="card-lbl">Locomotion:</span><span class="card-val">${behav.movement}</span></div>`;
        if (behav.social)      html += `<div class="card-row"><span class="card-lbl">Social:</span><span class="card-val">${behav.social}</span></div>`;
        if (behav.activity)    html += `<div class="card-row"><span class="card-lbl">Activity:</span><span class="card-val">${behav.activity}</span></div>`;
        if (profile.conservationStatus) html += `<div class="card-row"><span class="card-lbl">Conservation:</span><span class="card-val">${profile.conservationStatus}</span></div>`;

        if (profile.interestingFact) html += `<div class="card-fact-box"><span style="font-weight:600;color:#38bdf8;">💡 Fact: </span>${profile.interestingFact}</div>`;

        // Wikipedia link — only on verified name
        const wikiName = id.scientificName || tax.genus || tax.family || cls || null;
        html += this._wikiButtonHtml(wikiName, true);

        bodyEl.innerHTML = html;
      }
    }

    if (footEl) {
      if (profile.sources && profile.sources.length > 0) {
        footEl.textContent = `Sources: ${profile.sources.join(' · ')}`;
      } else if (isPending) {
        footEl.textContent = 'Querying authoritative sources…';
      } else {
        footEl.textContent = '';
      }
    }

    this.focusCard.classList.add('visible');
  }

  hideFocusCard() {
    if (this.focusCard) {
      this.focusCard.classList.remove('visible');
      this.currentFocusEntity = null;
    }
  }

  showDiscovery(entry, totalCount) {
    const titleEl = document.getElementById('toast-title');
    if (titleEl) titleEl.textContent = `${entry.displayName} (${entry.scientificName})`;
    
    this.toast.classList.add('show');
    setTimeout(() => this.toast.classList.remove('show'), 4000);

    const countEl = document.getElementById('codex-stat-discovered');
    if (countEl) {
      countEl.textContent = `🌊 ${totalCount} / 42 Discovered in Ocean`;
    }
  }

  updateDebug(fps, creatureCount, schoolCount, argoCount, gliderCount, depth) {
    if (!this.debugOverlay.classList.contains('open')) return;
    const fpsEl = document.getElementById('dbg-fps');
    const cEl = document.getElementById('dbg-creatures');
    const sEl = document.getElementById('dbg-schools');
    const aEl = document.getElementById('dbg-argo');
    const gEl = document.getElementById('dbg-gliders');
    const dEl = document.getElementById('dbg-depth');

    if (fpsEl) fpsEl.textContent = fps.toFixed(0);
    if (cEl) cEl.textContent = creatureCount;
    if (sEl) sEl.textContent = schoolCount;
    if (aEl) aEl.textContent = argoCount;
    if (gEl) gEl.textContent = gliderCount;
    if (dEl) dEl.textContent = `${depth.toFixed(1)} m`;
  }
}
