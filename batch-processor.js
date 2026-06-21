import { characters } from '../../../../script.js';

export class BatchProcessor {
    #cancelled = false;
    #progressPopup = null;

    async run(characterIds, options = {}) {
        const { processFn, delayMs = 0, label = 'Processing' } = options;
        this.#cancelled = false;

        const total = characterIds.length;
        let processed = 0;
        let errors = 0;
        const allProposals = [];
        const startTime = Date.now();

        this.showProgress(label, 0, total, '', 0, 0);

        for (const characterId of characterIds) {
            if (this.#cancelled) break;

            const character = characters[characterId];
            if (!character) {
                errors++;
                processed++;
                continue;
            }

            this.showProgress(label, processed, total, character.name, errors, startTime);

            try {
                const proposals = await processFn(characterId);
                allProposals.push(...proposals);
            } catch (err) {
                console.error(`Tag Automation: Error processing character ${character.name}`, err);
                errors++;
            }

            processed++;

            if (delayMs > 0 && processed < total && !this.#cancelled) {
                await this.delay(delayMs);
            }
        }

        this.hideProgress();
        return allProposals;
    }

    cancel() {
        this.#cancelled = true;
    }

    showProgress(label, processed, total, currentName, errors, startTime) {
        if (!this.#progressPopup) {
            const popup = document.createElement('div');
            popup.id = 'tag_automation_progress';
            popup.className = 'tag_automation_progress_overlay';
            popup.innerHTML = `
                <div class="tag_automation_progress_popup">
                    <h3 id="tag_automation_progress_title">${escapeHtmlAttr(label)}</h3>
                    <div class="tag_automation_progress_bar_container">
                        <div id="tag_automation_progress_bar" class="tag_automation_progress_bar"></div>
                    </div>
                    <p id="tag_automation_progress_text">Initializing...</p>
                    <p id="tag_automation_progress_time"></p>
                    <div id="tag_automation_progress_cancel" class="menu_button">Cancel</div>
                </div>
            `;
            document.body.appendChild(popup);
            this.#progressPopup = popup;

            popup.querySelector('#tag_automation_progress_cancel').addEventListener('click', () => {
                this.cancel();
            });
        }

        const pct = total > 0 ? (processed / total) * 100 : 0;
        const bar = this.#progressPopup.querySelector('#tag_automation_progress_bar');
        if (bar) bar.style.width = `${pct}%`;

        const text = this.#progressPopup.querySelector('#tag_automation_progress_text');
        if (text) text.textContent = `Processing ${processed} of ${total}${currentName ? `: ${currentName}` : ''}${errors > 0 ? ` (${errors} errors)` : ''}`;

        const timeEl = this.#progressPopup.querySelector('#tag_automation_progress_time');
        if (timeEl && startTime > 0 && processed > 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            const perItem = elapsed / processed;
            const remaining = Math.ceil(perItem * (total - processed));
            timeEl.textContent = `Elapsed: ${Math.ceil(elapsed)}s \u2022 Est. remaining: ${remaining}s`;
        }
    }

    hideProgress() {
        if (this.#progressPopup) {
            this.#progressPopup.remove();
            this.#progressPopup = null;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

function escapeHtmlAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
