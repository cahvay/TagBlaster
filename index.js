import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced, event_types, eventSource, characters } from '../../../../script.js';
import { ConnectionManagerRequestService } from '../../shared.js';
import { TagMappingManager } from './tag-mapping.js';
import { BatchProcessor } from './batch-processor.js';
import { ReviewUI } from './review-ui.js';

import { tags, tag_map, addTagsToEntity, getTagKeyForEntity } from '../../../tags.js';
import { power_user } from '../../../power-user.js';

const defaultSettings = {
    tag_mappings: {},
    do_not_map: [],
    llm_profile_id: '',
    llm_min_prevalence: 2,
    llm_require_colors: true,
};

function loadSettings() {
    if (!extension_settings.tag_automation) {
        extension_settings.tag_automation = {};
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings.tag_automation[key] === undefined) {
            extension_settings.tag_automation[key] = defaultSettings[key];
        }
    }
}

function saveSettings() {
    saveSettingsDebounced();
}

const tagMappingManager = new TagMappingManager();
const batchProcessor = new BatchProcessor();
const reviewUI = new ReviewUI();

async function applyMappingsForCharacter(characterId) {
    const character = characters[characterId];
    if (!character) return [];
    return tagMappingManager.applyMappings(character);
}

async function onApplyMappingsClick(characterIds) {
    const proposals = await batchProcessor.run(characterIds, {
        processFn: applyMappingsForCharacter,
        delayMs: 0,
        label: 'Applying tag mappings',
    });
    if (proposals.length > 0) {
        reviewUI.show(proposals);
    } else {
        toastr.info('No new tags to apply from mappings.');
    }
}

// ── bulk edit helpers ───────────────────────────────────────────────────────

function injectBulkTagButtons() {
    const controlsDiv = document.getElementById('dialogue_popup_controls');
    if (!controlsDiv) return;

    const existingMapping = document.getElementById('bulk_tag_popup_apply_mappings');
    const existingLlm = document.getElementById('bulk_tag_popup_llm_analyze');
    if (existingMapping || existingLlm) return;

    const mappingBtn = document.createElement('div');
    mappingBtn.id = 'bulk_tag_popup_apply_mappings';
    mappingBtn.className = 'menu_button';
    mappingBtn.title = 'Apply tag mappings to selected characters';
    mappingBtn.innerHTML = '<i class="fa-solid fa-tags margin-right-10px"></i>Apply Mappings';

    const cancelBtn = controlsDiv.querySelector('#bulk_tag_popup_cancel');
    if (cancelBtn) {
        cancelBtn.parentNode.insertBefore(mappingBtn, cancelBtn);
    } else {
        controlsDiv.appendChild(mappingBtn);
    }

    const characterData = controlsDiv.closest('#bulk_tags_div');
    const characterIds = characterData?.dataset?.characters
        ? JSON.parse(characterData.dataset.characters).characterIds
        : [];

    mappingBtn.addEventListener('click', () => onApplyMappingsClick(characterIds));
}

const _bulkTagSnapshots = new WeakMap();

function snapshotBulkCharacterTags(character) {
    if (_bulkTagSnapshots.has(character)) return false;
    const mappedNames = getMappedTagNames(character);
    if (mappedNames.length === 0) return false;
    _bulkTagSnapshots.set(character, {
        orig: character.tags ?? [],
        proxy: [...(character.tags ?? []), ...mappedNames],
    });
    character.tags = _bulkTagSnapshots.get(character).proxy;
    return true;
}

function restoreBulkCharacterTags(character) {
    const snap = _bulkTagSnapshots.get(character);
    if (!snap) return;
    if (character.tags === snap.proxy) {
        character.tags = snap.orig;
    }
    _bulkTagSnapshots.delete(character);
}

function hookBulkImportButtons() {
    const importAllBtn = document.getElementById('bulk_tag_popup_import_all_tags');
    const importExistingBtn = document.getElementById('bulk_tag_popup_import_existing_tags');
    if (!importAllBtn || !importExistingBtn) return;

    const run = async () => {
        const bulkDiv = document.getElementById('bulk_tags_div');
        if (!bulkDiv) return;
        let characterIds = [];
        try {
            characterIds = JSON.parse(bulkDiv.dataset.characters).characterIds;
        } catch { return; }

        for (const id of characterIds) {
            const character = characters[id];
            if (character) snapshotBulkCharacterTags(character);
        }

        await new Promise(r => setTimeout(r, 100));

        for (const id of characterIds) {
            const character = characters[id];
            if (character) restoreBulkCharacterTags(character);
        }
    };

    importAllBtn.addEventListener('click', run, true);
    importExistingBtn.addEventListener('click', run, true);
}

const bulkTagObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.id === 'bulk_tag_shadow_popup' || node.querySelector?.('#bulk_tag_shadow_popup')) {
                setTimeout(() => {
                    injectBulkTagButtons();
                    hookBulkImportButtons();
                }, 50);
                return;
            }
        }
    }
});

export async function init() {
    loadSettings();

    const html = await renderExtensionTemplateAsync('third-party/TagBlaster', 'index');
    $('#extensions_settings').append(html);

    try {
        ConnectionManagerRequestService.handleDropdown(
            '#tag_automation_llm_profile',
            extension_settings.tag_automation.llm_profile_id,
            (profile) => {
                extension_settings.tag_automation.llm_profile_id = profile?.id ?? '';
                saveSettings();
            },
        );
    } catch {
        $('#tag_automation_llm_profile').append('<option value="" disabled selected>Connection Manager unavailable</option>');
    }

    $('#tag_automation_require_colors').prop('checked', extension_settings.tag_automation.llm_require_colors);
    $('#tag_automation_require_colors').on('change', function () {
        extension_settings.tag_automation.llm_require_colors = !!$(this).prop('checked');
        saveSettings();
    });

    tagMappingManager.initUI();

    bulkTagObserver.observe(document.body, { childList: true });

    eventSource.on(event_types.CHARACTER_FIRST_MESSAGE_SELECTED, () => {
        // Auto-apply is now always on; keep hook for future use
    });

    hookTagImportPopup();
}

// ── single-character import hooks ────────────────────────────────────────────

const _tagSnapshots = new WeakMap();

function hookTagImportPopup() {
    document.addEventListener('change', async (e) => {
        const select = e.target.closest?.('#char-management-dropdown');
        if (!select) return;

        const targetId = $(select.selectedOptions).attr('id');
        if (targetId !== 'import_tags') return;

        const context = getContext();
        const chid = context.characterId;
        if (chid == null) return;
        const character = characters[chid];
        if (!character) return;

        const remembered = power_user.tag_import_setting;
        const isAuto = remembered && remembered !== 1; // 1 = ASK

        if (isAuto) {
            e.stopImmediatePropagation();
            select.selectedIndex = 0;

            const mappedNames = getMappedTagNames(character);
            const { importTags } = SillyTavern.getContext();
            const orig = character.tags ?? [];
            if (mappedNames.length > 0) {
                character.tags = [...orig, ...mappedNames];
            }
            await importTags(character, { importSetting: remembered });
            if (character.tags !== orig) {
                character.tags = orig;
            }
            return;
        }

        const mappedNames = getMappedTagNames(character);
        if (mappedNames.length === 0) return;
        if (_tagSnapshots.has(character)) return;

        const orig = character.tags ?? [];
        const proxy = [...orig, ...mappedNames];
        character.tags = proxy;
        _tagSnapshots.set(character, { orig, proxy });

        const restore = () => {
            const snap = _tagSnapshots.get(character);
            if (!snap) return;
            if (character.tags === snap.proxy) {
                character.tags = snap.orig;
            }
            _tagSnapshots.delete(character);
        };

        const failSafe = setTimeout(() => restore(), 3000);

        const pollDone = setInterval(() => {
            if (!document.querySelector('.import_tags_content')) {
                clearInterval(pollDone);
                clearTimeout(failSafe);
                setTimeout(() => restore(), 200);
            }
        }, 300);

        setTimeout(() => {
            clearInterval(pollDone);
            clearTimeout(failSafe);
            restore();
        }, 30000);
    }, true);
}

// ── shared helpers ───────────────────────────────────────────────────────────

function getMappedTagNames(character) {
    const mappings = tagMappingManager.getMappings();
    const names = [];
    for (const [embeddedKey, stTagNames] of Object.entries(mappings)) {
        if ((character.tags ?? []).some(t => t.trim().toLowerCase() === embeddedKey)) {
            for (const tagName of stTagNames) {
                if (!names.some(n => n.toLowerCase() === tagName.toLowerCase())) {
                    names.push(tagName);
                }
            }
        }
    }
    return names;
}

function getMappedTagsForCharacter(character) {
    const mappings = tagMappingManager.getMappings();
    if (Object.keys(mappings).length === 0) return { existing: [], newTags: [] };

    const entityKey = getTagKeyForEntity(character.avatar);
    const currentTagIds = entityKey ? (tag_map[entityKey] ?? []) : [];

    const mappedExisting = [];
    const mappedNew = [];

    for (const [embeddedKey, stTagNames] of Object.entries(mappings)) {
        const hasEmbedded = (character.tags ?? []).some(t => t.trim().toLowerCase() === embeddedKey);
        if (!hasEmbedded) continue;

        for (const tagName of stTagNames) {
            const existingTag = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase());
            if (existingTag && currentTagIds.includes(existingTag.id)) continue;

            if (existingTag) {
                if (!mappedExisting.some(t => t.id === existingTag.id)) {
                    mappedExisting.push(existingTag);
                }
            } else {
                if (!mappedNew.some(t => t.name.toLowerCase() === tagName.toLowerCase())) {
                    mappedNew.push(tagName);
                }
            }
        }
    }

    return { existing: mappedExisting, newTags: mappedNew };
}
