/**
 * Extras (порт из MG/Test):
 *   - NPC список с аватарками (триггер по имени в промпте);
 *   - Гардероб (одежда) персонажа/юзера с превью+описанием;
 *   - Avatar Library — кастомные аватарки персонажа/юзера, заменяющие дефолт;
 *   - Утилита resize изображений и инжект описания одежды в LLM-контекст.
 *
 * Все коллекции живут в `settings.extensionSettings[MODULE_NAME]`. Дефолты
 * добавлены в settings.js.
 */

import {
    getSettings,
    saveSettings,
    iigLog,
    MODULE_NAME,
} from './settings.js';

// ----- ID generators -----

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ----- Image resize (для аплоада в гардероб/avatar lib) -----

/**
 * Уменьшает картинку до maxSize по большей стороне, возвращает чистый base64
 * (без data: префикса). Если она меньше — возвращает исходный base64.
 */
export function resizeImageBase64(base64, maxSize = 512) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width <= maxSize && height <= maxSize) {
                resolve(base64);
                return;
            }
            const ratio = Math.min(maxSize / width, maxSize / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => resolve(base64);
        img.src = `data:image/png;base64,${base64}`;
    });
}

/**
 * Читает File → base64 (без префикса), опционально уменьшает.
 */
export async function fileToResizedBase64(file, maxSize = 512) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const base64 = String(dataUrl).split(',')[1] || '';
    return await resizeImageBase64(base64, maxSize);
}

// ============================================================
// NPC
// ============================================================

export function ensureNpcList(settings = getSettings()) {
    if (!Array.isArray(settings.npcList)) settings.npcList = [];
    return settings.npcList;
}

export function addNpc() {
    const settings = getSettings();
    const list = ensureNpcList(settings);
    const npc = {
        id: makeId('npc'),
        name: '',
        aliases: [],
        avatarData: null,
        appearance: '',
        enabled: true,
    };
    list.push(npc);
    saveSettings();
    return npc;
}

export function removeNpc(npcId) {
    const settings = getSettings();
    settings.npcList = ensureNpcList(settings).filter((n) => n.id !== npcId);
    saveSettings();
}

export function updateNpc(npcId, patch) {
    const settings = getSettings();
    const npc = ensureNpcList(settings).find((n) => n.id === npcId);
    if (!npc) return null;
    Object.assign(npc, patch);
    saveSettings();
    return npc;
}

export function toggleNpc(npcId) {
    const settings = getSettings();
    const npc = ensureNpcList(settings).find((n) => n.id === npcId);
    if (!npc) return null;
    npc.enabled = npc.enabled === false ? true : false;
    saveSettings();
    return npc;
}

/**
 * Detection of mentions of {{char}}/{{user}}/NPC по имени и алиасам.
 * Возвращает { charMentioned, userMentioned, npcIds }. Регистр не важен.
 */
export function detectMentionedEntities(prompt) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const lowered = String(prompt || '').toLowerCase();

    const result = { charMentioned: false, userMentioned: false, npcIds: [] };

    const charName = context.characters?.[context.characterId]?.name;
    if (charName && lowered.includes(String(charName).toLowerCase())) {
        result.charMentioned = true;
    }
    const userName = context.name1;
    if (userName && lowered.includes(String(userName).toLowerCase())) {
        result.userMentioned = true;
    }

    for (const npc of ensureNpcList(settings)) {
        if (!npc.name || npc.enabled === false) continue;
        const names = [npc.name, ...(Array.isArray(npc.aliases) ? npc.aliases : [])].filter(Boolean);
        for (const name of names) {
            if (lowered.includes(String(name).toLowerCase())) {
                result.npcIds.push(npc.id);
                break;
            }
        }
    }

    return result;
}

export function getMatchedNpcs(prompt) {
    const settings = getSettings();
    const { npcIds } = detectMentionedEntities(prompt);
    const list = ensureNpcList(settings);
    return npcIds
        .map((id) => list.find((n) => n.id === id))
        .filter((n) => n && n.enabled !== false);
}

// ============================================================
// Wardrobe
// ============================================================

export function ensureWardrobeItems(settings = getSettings()) {
    if (!Array.isArray(settings.wardrobeItems)) settings.wardrobeItems = [];
    for (const item of settings.wardrobeItems) {
        if (!Object.hasOwn(item, 'description')) item.description = '';
    }
    return settings.wardrobeItems;
}

export function addWardrobeItem(name, imageData, target = 'char') {
    const settings = getSettings();
    const items = ensureWardrobeItems(settings);
    const item = {
        id: makeId('ward'),
        name: String(name || '').trim() || 'Outfit',
        imageData,
        description: '',
        target: target === 'user' ? 'user' : 'char',
        createdAt: Date.now(),
    };
    items.push(item);
    saveSettings();
    return item;
}

export function removeWardrobeItem(itemId) {
    const settings = getSettings();
    if (settings.activeWardrobeChar === itemId) settings.activeWardrobeChar = null;
    if (settings.activeWardrobeUser === itemId) settings.activeWardrobeUser = null;
    settings.wardrobeItems = ensureWardrobeItems(settings).filter((w) => w.id !== itemId);
    saveSettings();
    updateWardrobeInjection();
}

export function setActiveWardrobe(itemId, target) {
    const settings = getSettings();
    const key = target === 'user' ? 'activeWardrobeUser' : 'activeWardrobeChar';
    settings[key] = settings[key] === itemId ? null : itemId;
    saveSettings();
    updateWardrobeInjection();
    return settings[key];
}

export function getActiveWardrobeItem(target, settings = getSettings()) {
    const id = target === 'user' ? settings.activeWardrobeUser : settings.activeWardrobeChar;
    if (!id) return null;
    return ensureWardrobeItems(settings).find((w) => w.id === id) || null;
}

export function updateWardrobeItemDescription(itemId, description) {
    const settings = getSettings();
    const item = ensureWardrobeItems(settings).find((w) => w.id === itemId);
    if (!item) return null;
    item.description = String(description || '');
    saveSettings();
    updateWardrobeInjection();
    return item;
}

/**
 * Инжектит описания активных нарядов (char + user) в LLM-промпт через
 * setExtensionPrompt. Вызывается при изменении активной одежды/описания
 * и на init / CHAT_CHANGED.
 *
 * Если injectWardrobeToChat выключен, инжект очищается.
 */
export function updateWardrobeInjection() {
    try {
        const context = SillyTavern.getContext();
        const settings = getSettings();
        const injectionKey = `${MODULE_NAME}_wardrobe`;

        if (typeof context.setExtensionPrompt !== 'function') {
            iigLog('WARN', 'setExtensionPrompt not available — wardrobe injection skipped');
            return;
        }

        if (!settings.injectWardrobeToChat) {
            context.setExtensionPrompt(injectionKey, '', 0, 0);
            return;
        }

        const parts = [];

        const charItem = getActiveWardrobeItem('char', settings);
        if (charItem?.description) {
            const charName = context.characters?.[context.characterId]?.name || 'Character';
            parts.push(`[${charName} is currently wearing: ${charItem.description}]`);
        }

        const userItem = getActiveWardrobeItem('user', settings);
        if (userItem?.description) {
            const userName = context.name1 || 'User';
            parts.push(`[${userName} is currently wearing: ${userItem.description}]`);
        }

        const text = parts.join('\n');
        const depth = Number.isFinite(settings.wardrobeInjectionDepth) ? settings.wardrobeInjectionDepth : 1;
        // position 1 = IN_PROMPT (после main prompt) — поведение MG.
        context.setExtensionPrompt(injectionKey, text, 1, depth);
        iigLog('INFO', `Wardrobe injection updated (${text.length} chars, depth=${depth})`);
    } catch (error) {
        iigLog('ERROR', 'Wardrobe injection error:', error);
    }
}

// ============================================================
// Avatar Library (кастомные аватарки персонажа/юзера)
// ============================================================

export function ensureAvatarItems(settings = getSettings()) {
    if (!Array.isArray(settings.avatarItems)) settings.avatarItems = [];
    return settings.avatarItems;
}

export function addAvatarItem(name, imageData, target = 'char') {
    const settings = getSettings();
    const items = ensureAvatarItems(settings);
    const item = {
        id: makeId('ava'),
        name: String(name || '').trim() || 'Avatar',
        imageData,
        target: target === 'user' ? 'user' : 'char',
        createdAt: Date.now(),
    };
    items.push(item);
    saveSettings();
    return item;
}

export function removeAvatarItem(itemId) {
    const settings = getSettings();
    if (settings.activeAvatarChar === itemId) settings.activeAvatarChar = null;
    if (settings.activeAvatarUser === itemId) settings.activeAvatarUser = null;
    settings.avatarItems = ensureAvatarItems(settings).filter((a) => a.id !== itemId);
    saveSettings();
}

export function setActiveAvatar(itemId, target) {
    const settings = getSettings();
    const key = target === 'user' ? 'activeAvatarUser' : 'activeAvatarChar';
    settings[key] = settings[key] === itemId ? null : itemId;
    saveSettings();
    return settings[key];
}

export function getActiveAvatarItem(target, settings = getSettings()) {
    const id = target === 'user' ? settings.activeAvatarUser : settings.activeAvatarChar;
    if (!id) return null;
    return ensureAvatarItems(settings).find((a) => a.id === id) || null;
}

// ============================================================
// Reference helpers (приводят активную одежду + матчнутых NPC к base64/dataUrl)
// ============================================================

/**
 * Собирает дополнительные референсы (NPC + активная одежда) в нужном формате
 * провайдера: 'base64' (OpenAI/Gemini/Naistera) или 'dataUrl' (OpenRouter/...).
 *
 * Возвращает массив строк готовых к push в `references` массив провайдера.
 */
export function collectExtraReferences(prompt, format = 'base64') {
    const settings = getSettings();
    const refs = [];

    const wrap = (b64) => format === 'dataUrl' ? `data:image/png;base64,${b64}` : b64;

    if (settings.autoDetectNames !== false) {
        for (const npc of getMatchedNpcs(prompt)) {
            if (!npc?.avatarData) continue;
            refs.push(wrap(npc.avatarData));
        }
    }

    const charItem = getActiveWardrobeItem('char', settings);
    if (charItem?.imageData) refs.push(wrap(charItem.imageData));

    const userItem = getActiveWardrobeItem('user', settings);
    if (userItem?.imageData) refs.push(wrap(userItem.imageData));

    return refs;
}

/**
 * Возвращает дополнительные текстовые блоки для встройки в финальный промпт
 * (NPC внешности + одежда). Используется в parser.buildFinalGenerationPrompt.
 *
 * Возвращает массив строк (каждая — отдельный блок), готовых к join('\n\n').
 */
export function buildExtraPromptBlocks(prompt) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const blocks = [];

    if (settings.autoDetectNames !== false) {
        for (const npc of getMatchedNpcs(prompt)) {
            if (!npc?.appearance) continue;
            blocks.push(`[NPC Reference: ${npc.name}'s appearance: ${npc.appearance}]`);
        }
    }

    const charItem = getActiveWardrobeItem('char', settings);
    if (charItem) {
        const charName = context.characters?.[context.characterId]?.name || 'Character';
        let text = `[CLOTHING OVERRIDE for ${charName}: ${charName} MUST be wearing the outfit shown in the clothing reference image "${charItem.name}". Ignore other clothing descriptions — use ONLY the referenced outfit.`;
        if (charItem.description) text += ` Detailed outfit description: ${charItem.description}`;
        text += ']';
        blocks.push(text);
    }

    const userItem = getActiveWardrobeItem('user', settings);
    if (userItem) {
        const userName = context.name1 || 'User';
        let text = `[CLOTHING OVERRIDE for ${userName}: ${userName} MUST be wearing the outfit shown in the clothing reference image "${userItem.name}". Ignore other clothing descriptions — use ONLY the referenced outfit.`;
        if (userItem.description) text += ` Detailed outfit description: ${userItem.description}`;
        text += ']';
        blocks.push(text);
    }

    return blocks;
}
