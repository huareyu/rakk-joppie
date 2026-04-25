/**
 * Inline Image Generation — entry point.
 *
 * Catches `[IMG:GEN:{json}]` tags in AI messages and `<img data-iig-instruction>`
 * and generates images via configured API.
 *
 * Вся логика вынесена в `src/`. Этот файл — только импорт + init.
 */

import {
    getSettings,
    migrateConnectionProfilesFromLegacy,
    migrateAdditionalReferencesToLorebook,
    saveSettings,
} from './src/settings.js';
import { createSettingsUI } from './src/ui.js';
import { addButtonsToExistingMessages, subscribeEvents } from './src/events.js';
import { registerIigBookMacro } from './src/references.js';
import { initLightbox } from './src/lightbox.js';
import { updateWardrobeInjection } from './src/extras.js';
import { syncFloatingButton } from './src/floatingWardrobe.js';

(function init() {
    const context = SillyTavern.getContext();

    // Load/seed settings eagerly so getSettings() сразу возвращает валидный объект.
    const settings = getSettings();

    // One-time migrations: заполняем connection profiles и переносим
    // старые additionalReferences в lorebooks[0] (идемпотентно).
    migrateConnectionProfilesFromLegacy(settings);
    migrateAdditionalReferencesToLorebook(settings);
    saveSettings();

    // Register {{iig-book}} macro — делает refs-список доступным для вставки
    // в карточки / пресеты, чтобы LLM видела какие триггеры можно ставить.
    registerIigBookMacro();

    // Create settings UI when app is ready.
    context.eventSource.on(context.event_types.APP_READY, () => {
        createSettingsUI();
        // Add buttons to any messages already in chat.
        addButtonsToExistingMessages();
        // Lightbox: делегированный click-handler на #chat, оверлей один на страницу.
        initLightbox();
        // Wardrobe injection — поднимает описания активных нарядов в LLM-контекст.
        updateWardrobeInjection();
        // Плавающая кнопка гардероба (если включена в настройках).
        syncFloatingButton();
        console.log('[IIG] Inline Image Generation extension loaded');
    });

    // На смену чата — пересинхронизируем wardrobe injection (depth + имена
    // персонажа/юзера могут поменяться).
    context.eventSource.on(context.event_types.CHAT_CHANGED, () => {
        setTimeout(() => updateWardrobeInjection(), 100);
    });

    subscribeEvents();

    console.log('[IIG] Inline Image Generation extension initialized');
})();
