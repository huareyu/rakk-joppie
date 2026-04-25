/**
 * Плавающая кнопка для быстрого выбора одежды (опциональная фича).
 *
 * Кнопка живёт в `<body>` (position: fixed), её можно перетаскивать.
 * При клике открывается popover-панель: табы Char/User + сетка нарядов,
 * клик по карточке — переключает активный наряд (как в settings UI).
 *
 * Включается чекбоксом в Wardrobe-табе (settings.showFloatingWardrobeBtn).
 */

import { getSettings, saveSettings, iigLog } from './settings.js';
import {
    ensureWardrobeItems,
    getActiveWardrobeItem,
    setActiveWardrobe,
    addWardrobeItem,
    fileToResizedBase64,
} from './extras.js';
import { generateWardrobeDescription } from './vision.js';
import { t } from './i18n.js';

const BTN_ID = 'iig_floating_wardrobe_btn';
const PANEL_ID = 'iig_floating_wardrobe_panel';

let btnEl = null;
let panelEl = null;
let outsideClickHandler = null;
let currentTab = 'char';

// ----- Mount / unmount -----

export function mountFloatingButton() {
    if (document.getElementById(BTN_ID)) return; // уже смонтирован
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'iig-fw-btn';
    btn.title = t`Wardrobe (drag to move, click to open)`;
    btn.innerHTML = '<i class="fa-solid fa-shirt"></i>';
    document.body.appendChild(btn);
    btnEl = btn;

    applyStoredPosition(btn);
    bindDragAndClick(btn);
    iigLog('INFO', 'Floating wardrobe button mounted');
}

export function unmountFloatingButton() {
    closePanel();
    document.getElementById(BTN_ID)?.remove();
    btnEl = null;
}

export function syncFloatingButton() {
    const settings = getSettings();
    if (settings.showFloatingWardrobeBtn) {
        mountFloatingButton();
    } else {
        unmountFloatingButton();
    }
}

// ----- Position handling (drag) -----

function applyStoredPosition(btn) {
    const settings = getSettings();
    const pos = settings.floatingWardrobeBtnPos;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        btn.style.left = `${clampX(pos.x)}px`;
        btn.style.top = `${clampY(pos.y)}px`;
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }
}

function clampX(x) {
    const max = window.innerWidth - 56;
    return Math.max(4, Math.min(max, x));
}

function clampY(y) {
    const max = window.innerHeight - 56;
    return Math.max(4, Math.min(max, y));
}

function bindDragAndClick(btn) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // только ЛКМ
        const rect = btn.getBoundingClientRect();
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        originX = rect.left;
        originY = rect.top;
        btn.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            moved = true;
            btn.classList.add('iig-fw-dragging');
        }
        if (moved) {
            const nx = clampX(originX + dx);
            const ny = clampY(originY + dy);
            btn.style.left = `${nx}px`;
            btn.style.top = `${ny}px`;
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        }
    };

    const onPointerUp = (e) => {
        if (!dragging) return;
        dragging = false;
        btn.classList.remove('iig-fw-dragging');
        btn.releasePointerCapture?.(e.pointerId);
        if (moved) {
            const rect = btn.getBoundingClientRect();
            const settings = getSettings();
            settings.floatingWardrobeBtnPos = { x: rect.left, y: rect.top };
            saveSettings();
            return;
        }
        // Клик без drag → открыть/закрыть панель.
        togglePanel();
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', () => { dragging = false; });
}

// ----- Popover panel -----

function togglePanel() {
    if (panelEl) closePanel();
    else openPanel();
}

function openPanel() {
    if (!btnEl) return;
    closePanel();

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.className = 'iig-fw-panel';
    panelEl.innerHTML = renderPanelInnerHtml();

    document.body.appendChild(panelEl);
    positionPanelNearButton();
    bindPanelEvents();

    // close on outside click
    outsideClickHandler = (e) => {
        if (panelEl?.contains(e.target)) return;
        if (btnEl?.contains(e.target)) return;
        closePanel();
    };
    setTimeout(() => document.addEventListener('mousedown', outsideClickHandler), 0);

    document.addEventListener('keydown', onPanelKeyDown);
}

function closePanel() {
    panelEl?.remove();
    panelEl = null;
    if (outsideClickHandler) {
        document.removeEventListener('mousedown', outsideClickHandler);
        outsideClickHandler = null;
    }
    document.removeEventListener('keydown', onPanelKeyDown);
}

function onPanelKeyDown(e) {
    if (e.key === 'Escape') closePanel();
}

function positionPanelNearButton() {
    if (!btnEl || !panelEl) return;
    const btnRect = btnEl.getBoundingClientRect();
    const panelW = 360;
    const panelH = Math.min(480, window.innerHeight - 40);
    panelEl.style.width = `${panelW}px`;
    panelEl.style.maxHeight = `${panelH}px`;

    // По умолчанию справа от кнопки + сверху. Если не влезает — слева/снизу.
    let left = btnRect.right + 8;
    if (left + panelW > window.innerWidth - 8) {
        left = btnRect.left - 8 - panelW;
    }
    if (left < 8) left = Math.max(8, window.innerWidth - panelW - 8);

    let top = btnRect.top;
    if (top + panelH > window.innerHeight - 8) {
        top = window.innerHeight - panelH - 8;
    }
    if (top < 8) top = 8;

    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
}

function renderPanelInnerHtml() {
    const settings = getSettings();
    const items = ensureWardrobeItems(settings);
    const charCount = items.filter((w) => w.target === 'char').length;
    const userCount = items.filter((w) => w.target === 'user').length;
    const activeItem = getActiveWardrobeItem(currentTab, settings);

    return `
        <div class="iig-fw-header">
            <span class="iig-fw-title"><i class="fa-solid fa-shirt"></i> ${t`Wardrobe`}</span>
            <div class="iig-fw-close" title="${t`Close`}"><i class="fa-solid fa-xmark"></i></div>
        </div>
        <div class="iig-fw-tabs">
            <div class="iig-fw-tab ${currentTab === 'char' ? 'iig-fw-tab-active' : ''}" data-fw-tab="char">
                ${t`Character`} <span class="iig-fw-count">${charCount}</span>
            </div>
            <div class="iig-fw-tab ${currentTab === 'user' ? 'iig-fw-tab-active' : ''}" data-fw-tab="user">
                ${t`User`} <span class="iig-fw-count">${userCount}</span>
            </div>
        </div>
        <div class="iig-fw-body">
            ${renderGridForTarget(currentTab)}
            <div class="iig-fw-add-row">
                <input type="text" class="iig-fw-name-input text_pole" placeholder="${t`Outfit name`}">
                <input type="file" class="iig-fw-file-input" accept="image/*" style="display:none">
                <div class="menu_button iig-fw-add-btn" title="${t`Upload outfit`}">
                    <i class="fa-solid fa-plus"></i>
                </div>
            </div>
        </div>
        <div class="iig-fw-footer">
            <span class="iig-fw-active-line">${renderActiveLine(currentTab)}</span>
            ${activeItem ? `<div class="menu_button iig-fw-vision-btn" title="${t`Describe via Vision AI`}"><i class="fa-solid fa-robot"></i></div>` : ''}
        </div>
    `;
}

function renderGridForTarget(target) {
    const settings = getSettings();
    const items = ensureWardrobeItems(settings).filter((w) => w.target === target);
    const activeId = target === 'user' ? settings.activeWardrobeUser : settings.activeWardrobeChar;

    if (items.length === 0) {
        return `<div class="iig-fw-empty">${t`No outfits for this target. Add some in the Wardrobe tab.`}</div>`;
    }

    return `<div class="iig-fw-grid">${items.map((item) => `
        <div class="iig-fw-card ${item.id === activeId ? 'iig-fw-card-active' : ''}" data-fw-id="${escapeAttr(item.id)}" data-fw-target="${target}" title="${escapeAttr(item.name)}">
            <img src="data:image/png;base64,${item.imageData}" class="iig-fw-img" alt="${escapeAttr(item.name)}">
            <div class="iig-fw-name">${escapeHtml(item.name)}</div>
            ${item.id === activeId ? '<div class="iig-fw-check"><i class="fa-solid fa-check"></i></div>' : ''}
        </div>
    `).join('')}</div>`;
}

function renderActiveLine(target) {
    const settings = getSettings();
    const item = getActiveWardrobeItem(target, settings);
    if (!item) return t`No active outfit`;
    return `${target === 'user' ? t`User` : t`Character`}: <b>${escapeHtml(item.name)}</b>`;
}

function bindPanelEvents() {
    if (!panelEl) return;

    panelEl.querySelector('.iig-fw-close')?.addEventListener('click', closePanel);

    panelEl.querySelectorAll('.iig-fw-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const next = tab.getAttribute('data-fw-tab');
            if (!next || next === currentTab) return;
            currentTab = next;
            refreshPanel();
        });
    });

    panelEl.querySelectorAll('.iig-fw-card').forEach((card) => {
        card.addEventListener('click', () => {
            const id = card.getAttribute('data-fw-id');
            const target = card.getAttribute('data-fw-target') || currentTab;
            if (!id) return;
            setActiveWardrobe(id, target);
            try {
                const settingsGrid = document.getElementById(target === 'user' ? 'iig_wardrobe_user' : 'iig_wardrobe_char');
                if (settingsGrid) {
                    settingsGrid.dispatchEvent(new CustomEvent('iig:wardrobe-refresh', { bubbles: true }));
                }
            } catch (_e) { /* no-op */ }
            refreshPanel();
        });
    });

    // ----- Upload new outfit -----
    const addBtn = panelEl.querySelector('.iig-fw-add-btn');
    const fileInput = panelEl.querySelector('.iig-fw-file-input');
    const nameInput = panelEl.querySelector('.iig-fw-name-input');

    addBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        try {
            const resized = await fileToResizedBase64(file, 512);
            const name = (nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '')
                || file.name.replace(/\.[^.]+$/, '')
                || 'Outfit';
            addWardrobeItem(name, resized, currentTab);
            if (nameInput instanceof HTMLInputElement) nameInput.value = '';
            if (fileInput instanceof HTMLInputElement) fileInput.value = '';
            try {
                const settingsGrid = document.getElementById(currentTab === 'user' ? 'iig_wardrobe_user' : 'iig_wardrobe_char');
                if (settingsGrid) {
                    settingsGrid.dispatchEvent(new CustomEvent('iig:wardrobe-refresh', { bubbles: true }));
                }
            } catch (_e) { /* no-op */ }
            refreshPanel();
            toastr.success(t`Outfit "${name}" added`, t`Image Generation`);
        } catch (error) {
            toastr.error(t`Failed to add outfit: ${error.message || error}`, t`Image Generation`);
        }
    });

    // ----- Vision describe button -----
    const visionBtn = panelEl.querySelector('.iig-fw-vision-btn');
    visionBtn?.addEventListener('click', async (e) => {
        const settings = getSettings();
        const item = getActiveWardrobeItem(currentTab, settings);
        if (!item) return;
        const btn = e.currentTarget;
        if (!(btn instanceof HTMLElement)) return;
        btn.classList.add('disabled');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            await generateWardrobeDescription(item.id);
            toastr.success(t`Description generated`, t`Image Generation`);
        } catch (error) {
            iigLog('ERROR', 'Floating wardrobe vision error:', error);
            toastr.error(t`Vision generation error: ${error.message || error}`, t`Image Generation`);
        } finally {
            btn.classList.remove('disabled');
            btn.innerHTML = originalHtml;
        }
    });
}

function refreshPanel() {
    if (!panelEl) return;
    panelEl.innerHTML = renderPanelInnerHtml();
    bindPanelEvents();
}

// ----- Helpers -----

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function escapeAttr(s) {
    return escapeHtml(s);
}
