/**
 * Vision API для авто-генерации текстовых описаний одежды по картинке.
 *
 * Использует свой эндпоинт/ключ/модель (settings.vision*). Если они пусты —
 * фолбэк на основные настройки API. Совместимо с OpenAI-style chat
 * completions (image_url + text в одном messages[0].content[]).
 */

import { getSettings, iigLog } from './settings.js';
import { getActiveWardrobeItem, updateWardrobeItemDescription, ensureWardrobeItems } from './extras.js';
import { t } from './i18n.js';

export const DEFAULT_VISION_PROMPT = 'Describe this clothing outfit in detail for a character in a roleplay. Focus on: type of garment, color, material/texture, style, notable features, accessories. Be concise but thorough (2-4 sentences). Write in English.';

function getEffectiveVisionConfig(settings = getSettings()) {
    const endpoint = String(settings.visionEndpoint || '').trim() || String(settings.endpoint || '').trim();
    const apiKey = String(settings.visionApiKey || '').trim() || String(settings.apiKey || '').trim();
    const model = String(settings.visionModel || '').trim();
    const promptText = String(settings.visionPrompt || '').trim() || DEFAULT_VISION_PROMPT;
    return { endpoint, apiKey, model, promptText };
}

/**
 * Тянет список моделей через OpenAI-совместимый /v1/models с эндпоинта,
 * настроенного для vision (или основного), без фильтра по image-keywords —
 * наоборот, отбираем не-image (text/vision/multimodal) модели.
 */
export async function fetchVisionModels() {
    const { endpoint, apiKey } = getEffectiveVisionConfig();
    if (!endpoint || !apiKey) return [];

    const url = `${endpoint.replace(/\/+$/, '')}/v1/models`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const list = Array.isArray(data?.data) ? data.data : [];
        // Эвристика: не отбрасываем по imageModel — отдаём всё, пользователь
        // выберет vision-capable. Только сортировка по id для удобства.
        return list.map((m) => String(m?.id || '')).filter(Boolean).sort();
    } catch (error) {
        iigLog('ERROR', `Vision fetchModels failed: ${error.message || error}`);
        toastr.error(t`Failed to load vision models: ${error.message || error}`, t`Image Generation`);
        return [];
    }
}

/**
 * Генерирует описание одежды по картинке wardrobe-item'а через vision API.
 * Бросает Error с понятным сообщением если конфиг неполный или ответ
 * пустой/ошибочный.
 *
 * @param {string} itemId
 * @returns {Promise<string>} сгенерированный текст описания
 */
export async function generateWardrobeDescription(itemId) {
    const settings = getSettings();
    const item = ensureWardrobeItems(settings).find((w) => w.id === itemId);
    if (!item?.imageData) throw new Error(t`No image data for this outfit`);

    const { endpoint, apiKey, model, promptText } = getEffectiveVisionConfig(settings);
    if (!endpoint) throw new Error(t`Vision endpoint not configured`);
    if (!apiKey) throw new Error(t`Vision API key not configured`);
    if (!model) throw new Error(t`Vision model not selected`);

    const url = `${endpoint.replace(/\/+$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${item.imageData}` } },
                    { type: 'text', text: promptText },
                ],
            }],
            max_tokens: 500,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API ${response.status}: ${String(errorText).slice(0, 400)}`);
    }

    const result = await response.json();
    const description = String(result?.choices?.[0]?.message?.content || '').trim();
    if (!description) throw new Error(t`Vision model returned empty response`);

    iigLog('INFO', `Vision generated description for "${item.name}": ${description.slice(0, 100)}`);
    updateWardrobeItemDescription(itemId, description);
    return description;
}
