import { tags, tag_map, addTagsToEntity, getTagKeyForEntity } from '../../../tags.js';
import { saveSettingsDebounced, printCharactersDebounced } from '../../../../script.js';
import { uuidv4 } from '../../../utils.js';

export class ReviewUI {
    #proposals = [];
    #modal = null;
    #filterMode = 'all';

    show(proposals) {
        this.#proposals = proposals.map(p => ({ ...p, accepted: true }));
        this.#filterMode = 'all';
        this.render();
    }

    render() {
        if (this.#modal) {
            this.#modal.remove();
        }

        const counts = this.getCounts();

        const modal = document.createElement('div');
        modal.id = 'tag_automation_review';
        modal.className = 'tag_automation_review_overlay';
        modal.innerHTML = `
            <div class="tag_automation_review_popup">
                <div class="tag_automation_review_header">
                    <h3>Tag Automation - Review Changes</h3>
                    <div class="tag_automation_review_bulk_actions">
                        <div id="ta_review_accept_all" class="menu_button">Accept All</div>
                        <div id="ta_review_reject_all" class="menu_button">Reject All</div>
                    </div>
                </div>
                <div class="tag_automation_review_filters">
                    <div class="ta_filter_btn${this.#filterMode === 'all' ? ' active' : ''}" data-filter="all">All</div>
                    <div class="ta_filter_btn${this.#filterMode === 'new' ? ' active' : ''}" data-filter="new">New Tags</div>
                    <div class="ta_filter_btn${this.#filterMode === 'llm' ? ' active' : ''}" data-filter="llm">LLM</div>
                    <div class="ta_filter_btn${this.#filterMode === 'mapping' ? ' active' : ''}" data-filter="mapping">Mappings</div>
                </div>
                <div class="tag_automation_review_list" id="ta_review_list"></div>
                <div class="tag_automation_review_footer">
                    <span id="ta_review_summary">${counts.total} tags for ${counts.charCount} character${counts.charCount !== 1 ? 's' : ''} &bull; ${counts.newTags} new &bull; ${counts.newColors} colored</span>
                    <div class="tag_automation_review_actions">
                        <div id="ta_review_cancel" class="menu_button">Cancel</div>
                        <div id="ta_review_apply" class="menu_button">Apply Selected</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.#modal = modal;

        const listEl = modal.querySelector('#ta_review_list');
        let lastCharName = '';

        for (let i = 0; i < this.#proposals.length; i++) {
            const p = this.#proposals[i];
            if (!this.matchesFilter(p)) continue;

            if (p.characterName !== lastCharName) {
                const charProposals = this.#proposals.filter(pp => pp.characterName === p.characterName && pp.accepted);
                const charTagSummary = charProposals.map(pp => {
                    if (pp.isNewTag && pp.color) {
                        return `<span class="ta_color_swatch" style="background:${escapeHtmlAttr(pp.color)};color:${escapeHtmlAttr(pp.color2 ?? '#ffffff')}">${escapeHtml(pp.tagName)}</span>`;
                    }
                    const existingTag = tags.find(t => t.id === pp.tagId);
                    if (existingTag?.color) {
                        return `<span class="ta_color_swatch" style="background:${escapeHtmlAttr(existingTag.color)};color:${escapeHtmlAttr(existingTag.color2 ?? '#ffffff')}">${escapeHtml(pp.tagName)}</span>`;
                    }
                    return `<span class="ta_color_swatch">${escapeHtml(pp.tagName)}</span>`;
                }).join(' ');

                const charHeader = document.createElement('div');
                charHeader.className = 'ta_review_char_header';
                charHeader.dataset.charName = p.characterName;
                charHeader.innerHTML = `
                    <div class="ta_review_char_header_top">
                        <span class="ta_char_name">${escapeHtml(p.characterName)}</span>
                        <span class="ta_char_toggle">toggle all</span>
                    </div>
                    <div class="ta_review_char_tags">${charTagSummary}</div>
                `;
                listEl.appendChild(charHeader);

                charHeader.querySelector('.ta_char_toggle').addEventListener('click', () => {
                    const charName = charHeader.dataset.charName;
                    const currentState = this.#proposals.filter(pp => pp.characterName === charName).some(pp => pp.accepted);
                    this.#proposals.forEach(pp => {
                        if (pp.characterName === charName) pp.accepted = !currentState;
                    });
                    this.render();
                });

                lastCharName = p.characterName;
            }

            const row = document.createElement('div');
            row.className = `ta_review_row${p.accepted ? ' accepted' : ' rejected'}${p.isNewTag ? ' new_tag' : ''}`;
            row.dataset.index = i;

            const sourceLabel = p.type === 'mapping' ? 'mapping' : p.type === 'llm_matched' ? 'LLM: matched' : 'LLM: new';

            let tagDisplay = '';
            if (p.isNewTag && p.color) {
                tagDisplay = `<span class="ta_color_swatch" style="background:${escapeHtmlAttr(p.color)};color:${escapeHtmlAttr(p.color2 ?? '#ffffff')}">${escapeHtml(p.tagName)}</span> <span class="ta_suggest_pill_badge">(NEW!)</span>`;
            } else {
                const existingTag = tags.find(t => t.id === p.tagId);
                if (existingTag?.color) {
                    tagDisplay = `<span class="ta_color_swatch" style="background:${escapeHtmlAttr(existingTag.color)};color:${escapeHtmlAttr(existingTag.color2 ?? '#ffffff')}">${escapeHtml(p.tagName)}</span>`;
                } else {
                    tagDisplay = `<span class="ta_color_swatch">${escapeHtml(p.tagName)}</span>`;
                }
            }

            row.innerHTML = `
                <input type="checkbox" class="ta_review_checkbox" ${p.accepted ? 'checked' : ''} />
                <span class="ta_review_char">${escapeHtml(p.characterName)}</span>
                <span class="ta_review_arrow">&rarr;</span>
                <span class="ta_review_tag">${tagDisplay}</span>
                <span class="ta_review_source">(${sourceLabel})</span>
                <span class="ta_review_expand" title="Show reasoning">&#9654;</span>
                <div class="ta_review_reasoning hidden">${escapeHtml(p.reasoning || 'No reasoning provided')}</div>
            `;

            const checkbox = row.querySelector('.ta_review_checkbox');
            checkbox.addEventListener('change', () => {
                this.#proposals[i].accepted = checkbox.checked;
                row.classList.toggle('accepted', checkbox.checked);
                row.classList.toggle('rejected', !checkbox.checked);
                this.updateSummary();
            });

            const expandBtn = row.querySelector('.ta_review_expand');
            const reasoningEl = row.querySelector('.ta_review_reasoning');
            expandBtn.addEventListener('click', () => {
                reasoningEl.classList.toggle('hidden');
                expandBtn.innerHTML = reasoningEl.classList.contains('hidden') ? '&#9654;' : '&#9660;';
            });

            if (p.isNewTag && p.color) {
                const tagEl = row.querySelector('.ta_review_tag .ta_color_swatch') ?? row.querySelector('.ta_review_tag');
                tagEl.addEventListener('click', () => {
                    const input = document.createElement('input');
                    input.type = 'color';
                    input.value = p.color;
                    input.addEventListener('input', () => {
                        this.#proposals[i].color = input.value;
                        if (tagEl.style) {
                            tagEl.style.background = input.value;
                        }
                    });
                    input.click();
                });
                tagEl.style.cursor = 'pointer';
                tagEl.title = 'Click to change color';
            }

            listEl.appendChild(row);
        }

        modal.querySelector('#ta_review_accept_all').addEventListener('click', () => {
            this.#proposals.forEach(p => p.accepted = true);
            this.render();
        });

        modal.querySelector('#ta_review_reject_all').addEventListener('click', () => {
            this.#proposals.forEach(p => p.accepted = false);
            this.render();
        });

        modal.querySelectorAll('.ta_filter_btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.#filterMode = btn.dataset.filter;
                this.render();
            });
        });

        modal.querySelector('#ta_review_cancel').addEventListener('click', () => {
            this.close();
        });

        modal.querySelector('#ta_review_apply').addEventListener('click', () => {
            this.applySelected();
        });
    }

    getCounts() {
        const accepted = this.#proposals.filter(p => p.accepted);
        const newTags = new Set(accepted.filter(p => p.isNewTag).map(p => p.tagName.toLowerCase()));
        const newColors = accepted.filter(p => p.isNewTag && p.color).length;
        const charCount = new Set(accepted.map(p => p.characterName)).size;
        return { total: accepted.length, newTags: newTags.size, newColors, charCount };
    }

    updateSummary() {
        const counts = this.getCounts();
        const summaryEl = this.#modal?.querySelector('#ta_review_summary');
        if (summaryEl) {
            summaryEl.textContent = `${counts.total} tags for ${counts.charCount} character${counts.charCount !== 1 ? 's' : ''} \u2022 ${counts.newTags} new \u2022 ${counts.newColors} colored`;
        }
    }

    matchesFilter(proposal) {
        switch (this.#filterMode) {
            case 'new': return proposal.isNewTag;
            case 'llm': return proposal.type !== 'mapping';
            case 'mapping': return proposal.type === 'mapping';
            default: return true;
        }
    }

    applySelected() {
        const accepted = this.#proposals.filter(p => p.accepted);
        if (accepted.length === 0) {
            toastr.info('No changes selected to apply.');
            this.close();
            return;
        }

        let applied = 0;
        let skipped = 0;

        for (const proposal of accepted) {
            const entityKey = getTagKeyForEntity(proposal.characterAvatar);
            if (!entityKey) {
                console.warn(`Tag Automation: Could not resolve entity key for "${proposal.characterAvatar}" (${proposal.characterName})`);
                skipped++;
                continue;
            }

            let tag;
            if (proposal.isNewTag) {
                tag = findOrCreateTag(proposal.tagName);
                if (tag && proposal.color) {
                    tag.color = proposal.color;
                    tag.color2 = proposal.color2 ?? '#ffffff';
                }
            } else {
                tag = tags.find(t => t.id === proposal.tagId) ?? findTagByName(proposal.tagName);
            }

            if (!tag) {
                console.warn(`Tag Automation: Could not find or create tag "${proposal.tagName}"`);
                skipped++;
                continue;
            }

            const currentTagIds = tag_map[entityKey] ?? [];
            if (!currentTagIds.includes(tag.id)) {
                addTagsToEntity(tag, entityKey);
                applied++;
            } else {
                skipped++;
            }
        }

        saveSettingsDebounced();
        printCharactersDebounced();

        if (applied > 0) {
            toastr.success(`Applied ${applied} tag${applied !== 1 ? 's' : ''}.${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
        } else {
            toastr.info(`No new tags to apply. ${skipped} skipped.`);
        }

        this.close();
    }

    close() {
        if (this.#modal) {
            this.#modal.remove();
            this.#modal = null;
        }
        this.#proposals = [];
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

function findTagByName(name) {
    const lower = name.toLowerCase();
    return tags.find(t => t.name.toLowerCase() === lower) ?? null;
}

function findOrCreateTag(tagName) {
    const existing = findTagByName(tagName);
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
