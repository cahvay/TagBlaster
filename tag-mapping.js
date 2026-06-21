import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, characters } from '../../../../script.js';
import { tags, tag_map, addTagsToEntity, getTagKeyForEntity } from '../../../tags.js';
import { uuidv4 } from '../../../utils.js';

const IMPORT_EXCLUDED_TAGS = new Set(['ROOT', 'TAVERN'].map(t => t.toLowerCase()));

export class TagMappingManager {
    getMappings() {
        return extension_settings.tag_automation?.tag_mappings ?? {};
    }

    addMapping(embeddedTag, stTagNames) {
        const mappings = this.getMappings();
        const key = embeddedTag.trim().toLowerCase();
        if (!key) return;
        const existing = mappings[key] ?? [];
        const merged = [...new Set([...existing, ...stTagNames.map(t => t.trim()).filter(t => t)])];
        mappings[key] = merged;
        extension_settings.tag_automation.tag_mappings = mappings;
        saveSettingsDebounced();
    }

    removeMapping(embeddedTag) {
        const mappings = this.getMappings();
        const key = embeddedTag.trim().toLowerCase();
        delete mappings[key];
        extension_settings.tag_automation.tag_mappings = mappings;
        saveSettingsDebounced();
    }

    getDoNotMap() {
        return extension_settings.tag_automation?.do_not_map ?? [];
    }

    addDoNotMap(embeddedTag) {
        const key = embeddedTag.trim().toLowerCase();
        if (!key) return;
        const list = this.getDoNotMap();
        if (list.includes(key)) return;
        list.push(key);
        extension_settings.tag_automation.do_not_map = list;
        saveSettingsDebounced();
    }

    removeDoNotMap(embeddedTag) {
        const key = embeddedTag.trim().toLowerCase();
        const list = this.getDoNotMap().filter(t => t.toLowerCase() !== key);
        extension_settings.tag_automation.do_not_map = list;
        saveSettingsDebounced();
    }

    applyMappings(character) {
        const mappings = this.getMappings();
        const embeddedTags = (character.tags ?? [])
            .map(t => t.trim())
            .filter(t => t && !IMPORT_EXCLUDED_TAGS.has(t.toLowerCase()));

        const entityKey = getTagKeyForEntity(character.avatar);
        const currentTagIds = entityKey ? (tag_map[entityKey] ?? []) : [];
        const proposals = [];

        for (const embeddedTag of embeddedTags) {
            const key = embeddedTag.toLowerCase();
            const stTagNames = mappings[key];
            if (!stTagNames) continue;

            for (const tagName of stTagNames) {
                const existingTag = this.findTagByName(tagName);
                if (existingTag && currentTagIds.includes(existingTag.id)) continue;

                proposals.push({
                    type: 'mapping',
                    characterName: character.name,
                    characterAvatar: character.avatar,
                    tagName: existingTag ? existingTag.name : tagName,
                    tagId: existingTag?.id ?? null,
                    isNewTag: !existingTag,
                    color: existingTag?.color ?? null,
                    color2: existingTag?.color2 ?? null,
                    reasoning: `Mapped from embedded tag "${embeddedTag}"`,
                });
            }
        }

        return proposals;
    }

    applyProposals(proposals) {
        for (const proposal of proposals) {
            const entityKey = getTagKeyForEntity(proposal.characterAvatar);
            if (!entityKey) continue;

            const tag = findOrCreateTag(proposal.tagName);
            if (!tag) continue;

            const currentTagIds = tag_map[entityKey] ?? [];
            if (!currentTagIds.includes(tag.id)) {
                addTagsToEntity(tag, entityKey);
            }
        }
    }

    getUnmappedEmbeddedTags() {
        const mappings = this.getMappings();
        const doNotMap = this.getDoNotMap();
        const counts = {};

        for (const character of characters) {
            if (!character?.tags) continue;
            for (const tag of character.tags) {
                const trimmed = tag.trim();
                const key = trimmed.toLowerCase();
                if (trimmed && !IMPORT_EXCLUDED_TAGS.has(key) && !mappings[key] && !doNotMap.includes(key) && !this.findTagByName(trimmed)) {
                    if (!counts[key]) {
                        counts[key] = { name: trimmed, count: 0 };
                    }
                    counts[key].count++;
                }
            }
        }

        return Object.values(counts)
            .sort((a, b) => b.count - a.count);
    }

    initUI() {
        this.renderMappingsList();
        this.renderBlockedList();

        // Collapsible toggle handler
        $(document).on('click', '.ta_collapsible_header', (e) => {
            const header = $(e.currentTarget);
            const targetId = header.data('target');
            const body = $(`#${targetId}`);
            const icon = header.find('.ta_collapsible_icon');
            if (body.is(':visible')) {
                body.hide();
                icon.removeClass('down').addClass('right');
            } else {
                body.show();
                icon.removeClass('right').addClass('down');
            }
        });

        $('#tag_automation_mapping_add').on('click', () => {
            const embedded = $('#tag_automation_mapping_embedded').val().trim();
            const stTagsStr = $('#tag_automation_mapping_st_tags').val().trim();
            if (!embedded) return;
            if (!stTagsStr) {
                this.addDoNotMap(embedded);
            } else {
                const stTagNames = stTagsStr.split(',').map(t => t.trim()).filter(t => t);
                this.addMapping(embedded, stTagNames);
            }
            $('#tag_automation_mapping_embedded').val('');
            $('#tag_automation_mapping_st_tags').val('');
            this.renderMappingsList();
            this.renderBlockedList();
        });

        $('#tag_automation_import_unmapped').on('click', () => {
            this.showUnmappedDialog();
        });
    }

    renderMappingsList() {
        const container = $('#tag_automation_mappings_list');
        container.empty();
        const mappings = this.getMappings();
        const keys = Object.keys(mappings);

        if (keys.length === 0) {
            container.append('<div class="ta_empty_hint">No mappings configured.</div>');
            return;
        }

        for (const [embeddedTag, stTagNames] of Object.entries(mappings)) {
            const row = $('<div class="tag_automation_mapping_row flex-container gap5px flexnowrap marginBot5"></div>');
            const deleteBtn = $('<div class="menu_button menu_button_icon margin0 tag_automation_mapping_delete" title="Delete mapping"><i class="fa-solid fa-xmark"></i></div>');
            const label = $(`<span class="tag_automation_mapping_embedded">${escapeHtml(embeddedTag)}</span>`);
            const arrow = $('<span class="tag_automation_mapping_arrow">&rarr;</span>');

            const pills = stTagNames.map(tagName => {
                const existing = this.findTagByName(tagName);
                const pillColor = existing?.color ? `background:${escapeHtmlAttr(existing.color)};color:${escapeHtmlAttr(existing.color2 ?? '#ffffff')}` : '';
                return `<span class="ta_mapping_pill" style="${pillColor}">${escapeHtml(tagName)}</span>`;
            }).join('');

            const tagsLabel = $(`<span class="tag_automation_mapping_pills">${pills}</span>`);

            deleteBtn.on('click', () => {
                this.removeMapping(embeddedTag);
                this.renderMappingsList();
            });

            row.append(deleteBtn, label, arrow, tagsLabel);
            container.append(row);
        }
    }

    renderBlockedList() {
        const container = $('#tag_automation_blocked_list');
        if (!container.length) return;
        container.empty();
        const blocked = this.getDoNotMap();

        if (blocked.length === 0) {
            container.append('<div class="ta_empty_hint">No tags blocked.</div>');
            return;
        }

        for (const tag of blocked) {
            const row = $('<div class="tag_automation_mapping_row flex-container gap5px flexnowrap marginBot5"></div>');
            const deleteBtn = $('<div class="menu_button menu_button_icon margin0 tag_automation_mapping_delete" title="Remove block"><i class="fa-solid fa-xmark"></i></div>');
            const label = $(`<span class="tag_automation_mapping_embedded">${escapeHtml(tag)}</span>`);

            deleteBtn.on('click', () => {
                this.removeDoNotMap(tag);
                this.renderBlockedList();
            });

            row.append(deleteBtn, label);
            container.append(row);
        }
    }

    async showUnmappedDialog() {
        const unmapped = this.getUnmappedEmbeddedTags();
        if (unmapped.length === 0) {
            toastr.info('All embedded tags already have mappings.');
            return;
        }

        const savedMinPrevalence = extension_settings.tag_automation?.llm_min_prevalence ?? 2;
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        let html = '<div class="tag_automation_unmapped_list">';
        for (const tag of unmapped) {
            html += `<div class="tag_automation_unmapped_row flex-container gap5px flexnowrap marginBot5">
                <span class="tag_automation_unmapped_count" title="Used by ${tag.count} character(s)">${tag.count}x</span>
                <input class="text_pole flex1 tag_automation_unmapped_embedded" value="${escapeHtml(tag.name)}" readonly />
                <input class="text_pole flex2 tag_automation_unmapped_st_tags" placeholder="ST tag names (comma-separated)" />
            </div>`;
        }
        html += '</div>';
        html += `<div class="marginTop5 flex-container gap5px flexnowrap" style="align-items:center">
            <label for="ta_min_prevalence_input" style="white-space:nowrap">Min prevalence for LLM:</label>
            <input id="ta_min_prevalence_input" type="number" class="text_pole" style="width:60px" min="1" max="100" value="${savedMinPrevalence}" />
        </div>`;

        const LLM_SUGGEST_RESULT = 100;
        let capturedMinPrevalence = savedMinPrevalence;
        const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'Import Unmapped Embedded Tags', {
            okButton: 'Add Mappings',
            cancelButton: 'Cancel',
            customButtons: [
                { text: 'LLM Suggest', result: LLM_SUGGEST_RESULT, icon: 'fa-robot' },
            ],
            onClosing: (popup) => {
                const input = popup.dlg.querySelector('#ta_min_prevalence_input');
                if (input) {
                    capturedMinPrevalence = Number(input.value) || savedMinPrevalence;
                }
                return true;
            },
        });

        if (result !== 1 && result !== LLM_SUGGEST_RESULT) return;

        if (result === LLM_SUGGEST_RESULT) {
            extension_settings.tag_automation.llm_min_prevalence = capturedMinPrevalence;
            saveSettingsDebounced();
            await this.llmSuggestMappings(unmapped, capturedMinPrevalence);
            return;
        }

        this.collectManualMappings();
    }

    async llmSuggestMappings(unmapped, minPrevalence) {
        const { extension_settings } = await import('../../../extensions.js');
        const profileId = extension_settings.tag_automation?.llm_profile_id;
        if (!profileId) {
            try {
                const { ConnectionManagerRequestService } = await import('../../shared.js');
                ConnectionManagerRequestService.getSupportedProfiles();
            } catch {
                toastr.error('Connection Manager is not available. Enable it or select a profile.');
                return;
            }
            toastr.warning('Select a Connection Profile in Tag Automation settings first.');
            return;
        }

        const significant = unmapped.filter(t => t.count >= minPrevalence);
        if (significant.length === 0) {
            toastr.info(`No embedded tags appear on ${minPrevalence}+ characters. LLM mapping suggestions work best for tags used across multiple cards.`);
            return;
        }

        const requireColors = extension_settings.tag_automation?.llm_require_colors ?? true;
        const { LlmTagger } = await import('./llm-tagger.js');
        const tagger = new LlmTagger();

        const overlay = this.showProgressOverlay();
        const startTime = Date.now();

        const onProgress = ({ tokens, thinkingTokens, streaming, waiting, done }) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const statusEl = document.getElementById('ta_progress_status');
            const tokensEl = document.getElementById('ta_progress_tokens');
            const thinkingEl = document.getElementById('ta_progress_thinking');
            if (!statusEl) return;

            if (waiting) {
                statusEl.textContent = 'Waiting for response...';
            } else if (streaming) {
                statusEl.textContent = 'Receiving response...';
            } else if (done) {
                statusEl.textContent = 'Complete';
            }

            if (tokensEl) tokensEl.textContent = tokens;
            const thinkingStat = document.getElementById('ta_progress_thinking_stat');
            if (thinkingEl) thinkingEl.textContent = thinkingTokens;
            if (thinkingStat) thinkingStat.style.display = thinkingTokens > 0 ? '' : 'none';
        };

        const suggestions = await tagger.suggestMappings(significant, {
            profileId,
            requireColors,
            onProgress,
        });

        this.hideProgressOverlay(overlay);

        if (suggestions.length === 0) {
            toastr.info('No mapping suggestions from LLM.');
            return;
        }

        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        let html = '<div class="ta_suggest_toolbar flex-container gap5px flexnowrap marginBot5" style="align-items:center">';
        html += '<label class="checkbox_label" style="white-space:nowrap"><input type="checkbox" id="ta_suggest_select_all" checked /> Select All</label>';
        html += '</div>';

        const groups = new Map();
        const groupOrder = [];
        for (let i = 0; i < suggestions.length; i++) {
            const s = suggestions[i];
            const key = s.doNotMap ? '__dnm__' : s.stTagNames.map(t => t.toLowerCase()).sort().join('|');
            if (!groups.has(key)) {
                groups.set(key, []);
                groupOrder.push(key);
            }
            groups.get(key).push(i);
        }

        const dnmIdx = groupOrder.indexOf('__dnm__');
        if (dnmIdx !== -1) {
            groupOrder.splice(dnmIdx, 1);
            groupOrder.push('__dnm__');
        }

        html += '<div class="tag_automation_llm_suggest_list">';
        for (const groupKey of groupOrder) {
            const indices = groups.get(groupKey);
            const first = suggestions[indices[0]];

            let targetPills;
            if (first.doNotMap) {
                targetPills = '<span class="ta_suggest_pill ta_suggest_pill_dnm">Do Not Map</span>';
            } else {
                targetPills = first.stTagNames.map(tagName => {
                    const existing = this.findTagByName(tagName);
                    const isNew = !existing;
                    let colorStyle = '';
                    let badge = '';
                    if (isNew) {
                        if (first.newTagColor) {
                            colorStyle = `background:${escapeHtmlAttr(first.newTagColor)};color:${escapeHtmlAttr(first.newTagColor2 ?? '#ffffff')}`;
                        }
                        badge = '<span class="ta_suggest_pill_badge">(NEW!)</span>';
                    } else {
                        if (existing.color) {
                            colorStyle = `background:${escapeHtmlAttr(existing.color)};color:${escapeHtmlAttr(existing.color2 ?? '#ffffff')}`;
                        }
                    }
                    return `<span class="ta_suggest_pill_wrap"><span class="ta_suggest_pill${isNew ? ' ta_suggest_pill_new' : ' ta_suggest_pill_existing'}" style="${colorStyle}">${escapeHtml(tagName)}</span>${badge}</span>`;
                }).join(' ');
            }

            html += `<div class="ta_suggest_group" data-group-key="${escapeHtmlAttr(groupKey)}">`;
            html += `<div class="ta_suggest_group_sources">`;

            for (const i of indices) {
                const suggestion = suggestions[i];
                html += `<div class="tag_automation_llm_suggest_row" data-suggest-index="${i}">
                    <div class="ta_suggest_row_top flex-container gap5px flexnowrap">
                        <input type="checkbox" class="ta_suggest_check" data-suggest-index="${i}" checked />
                        <span class="tag_automation_unmapped_count" title="Used by ${suggestion.count} character(s)">${suggestion.count}x</span>
                        <span class="ta_suggest_embedded_name">${escapeHtml(suggestion.embeddedTag)}</span>
                        <span class="tag_automation_mapping_arrow">&rarr;</span>
                    </div>
                    ${suggestion.reasoning ? `<div class="ta_suggest_reasoning">${escapeHtml(suggestion.reasoning)}</div>` : ''}
                </div>`;
            }
            html += '</div>';
            html += `<div class="ta_suggest_group_target">${targetPills}</div>`;
            html += '</div>';
        }
        html += '</div>';

        const selectedIndices = new Set(suggestions.map((_, i) => i));

        const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, 'LLM Mapping Suggestions', {
            okButton: 'Add Selected',
            cancelButton: 'Cancel',
            allowVerticalScrolling: true,
            onOpen: () => {
                const selectAll = document.getElementById('ta_suggest_select_all');
                const checkboxes = document.querySelectorAll('.ta_suggest_check');
                const updateRowDim = (cb) => {
                    const row = cb.closest('.tag_automation_llm_suggest_row');
                    if (row) row.classList.toggle('ta_row_unchecked', !cb.checked);
                    const group = cb.closest('.ta_suggest_group');
                    if (group) {
                        const groupChecks = group.querySelectorAll('.ta_suggest_check');
                        const anyChecked = Array.from(groupChecks).some(c => c.checked);
                        const target = group.querySelector('.ta_suggest_group_target');
                        if (target) target.classList.toggle('ta_target_unchecked', !anyChecked);
                    }
                };
                selectAll?.addEventListener('change', () => {
                    checkboxes.forEach(cb => {
                        cb.checked = selectAll.checked;
                        const idx = Number(cb.dataset.suggestIndex);
                        if (selectAll.checked) selectedIndices.add(idx);
                        else selectedIndices.delete(idx);
                        updateRowDim(cb);
                    });
                });
                checkboxes.forEach(cb => {
                    cb.addEventListener('change', () => {
                        const idx = Number(cb.dataset.suggestIndex);
                        if (cb.checked) {
                            selectedIndices.add(idx);
                        } else {
                            selectedIndices.delete(idx);
                        }
                        const total = checkboxes.length;
                        if (selectAll) selectAll.checked = selectedIndices.size === total;
                        updateRowDim(cb);
                    });
                });
            },
        });

        if (result !== 1) return;

        for (const index of selectedIndices) {
            const suggestion = suggestions[index];
            if (!suggestion) continue;

            if (suggestion.doNotMap) {
                this.addDoNotMap(suggestion.embeddedTag);
                continue;
            }

            this.addMapping(suggestion.embeddedTag, suggestion.stTagNames);

            if (suggestion.isNewTag) {
                for (const tagName of suggestion.stTagNames) {
                    if (!this.findTagByName(tagName)) {
                        const tag = findOrCreateTag(tagName);
                        if (suggestion.newTagColor && !tag.color) {
                            tag.color = suggestion.newTagColor;
                            tag.color2 = suggestion.newTagColor2 ?? '#ffffff';
                        }
                    }
                }
            }
        }
        this.renderMappingsList();
        this.renderBlockedList();
    }

    collectManualMappings() {
        const rows = document.querySelectorAll('.tag_automation_unmapped_row');
        for (const row of rows) {
            const embedded = row.querySelector('.tag_automation_unmapped_embedded').value.trim();
            const stTagsStr = row.querySelector('.tag_automation_unmapped_st_tags').value.trim();
            if (!embedded || !stTagsStr) continue;
            const stTagNames = stTagsStr.split(',').map(t => t.trim()).filter(t => t);
            this.addMapping(embedded, stTagNames);
        }
        this.renderMappingsList();
        this.renderBlockedList();
    }

    findTagByName(name) {
        const lower = name.toLowerCase();
        return tags.find(t => t.name.toLowerCase() === lower) ?? null;
    }

    showProgressOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'ta_llm_progress_overlay';
        overlay.innerHTML = `<div class="ta_llm_progress_card">
            <div class="ta_llm_progress_spinner"><i class="fa-solid fa-spinner fa-spin"></i></div>
            <div class="ta_llm_progress_title">Analyzing tags with LLM</div>
            <div id="ta_progress_status" class="ta_llm_progress_status">Connecting...</div>
            <div class="ta_llm_progress_stats">
                <div class="ta_llm_progress_stat">
                    <span class="ta_llm_progress_stat_label">Tokens</span>
                    <span id="ta_progress_tokens" class="ta_llm_progress_stat_value">0</span>
                </div>
                <div class="ta_llm_progress_stat" id="ta_progress_thinking_stat" style="display:none">
                    <span class="ta_llm_progress_stat_label">Thinking</span>
                    <span id="ta_progress_thinking" class="ta_llm_progress_stat_value">0</span>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    hideProgressOverlay(overlay) {
        overlay?.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeHtmlAttr(text) {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function findOrCreateTag(tagName) {
    const lower = tagName.toLowerCase();
    const existing = tags.find(t => t.name.toLowerCase() === lower);
    if (existing) return existing;

    const tag = {
        id: uuidv4(),
        name: tagName,
        folder_type: 'NONE',
        filter_state: 'UNDEFINED',
        sort_order: Math.max(0, ...tags.map(t => t.sort_order)) + 1,
        is_hidden_on_character_card: false,
        color: '',
        color2: '',
        create_date: Date.now(),
    };
    tags.push(tag);
    return tag;
}
