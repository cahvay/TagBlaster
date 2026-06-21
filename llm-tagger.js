import { tags, tag_map, getTagKeyForEntity } from '../../../tags.js';
import { ConnectionManagerRequestService } from '../../shared.js';
import { TagMappingManager } from './tag-mapping.js';

const SYSTEM_PROMPT = `You are a character card tagger for SillyTavern. Your job is to analyze character cards and suggest appropriate tags.

You will receive:
1. A list of existing SillyTavern tags (with their background and foreground colors)
2. A character's card information
3. The character's embedded tags

You MUST respond with ONLY valid JSON in this exact format, no other text, no markdown code fences:
{
  "matched_tags": ["Existing Tag Name 1", "Existing Tag Name 2"],
  "new_tags": [
    { "name": "New Tag Name", "color": "#hexcolor", "color2": "#hexcolor" }
  ],
  "reasoning": "Brief explanation of your tag choices"
}

Rules:
- matched_tags: Names of existing tags that apply. Use EXACT names from the provided tag list (case-insensitive match is OK).
- new_tags: Tags that should exist but don't yet. You MUST provide both color and color2 for every new tag. color is the background color. color2 is the foreground (text) color, chosen for contrast against the background. Pick colors that harmonize with existing tag colors of similar type.
- If two tags have overlapping but distinct meanings (e.g., "Fantasy" and "Dark Fantasy"), keep them as separate tags rather than collapsing them. Only merge when they are truly synonymous.
- Only suggest tags that are genuinely significant and useful for finding/filtering this character.
- Do NOT suggest tags that are already assigned to this character.
- Limit new_tags to at most 5 suggestions.
- Do not include tags that would be redundant with matched_tags.`;

const SYSTEM_PROMPT_NO_COLORS = SYSTEM_PROMPT.replace('You MUST provide both color and color2 for every new tag. color is the background color. color2 is the foreground (text) color, chosen for contrast against the background. ', '');

const MAPPING_SUGGEST_SYSTEM_PROMPT = `You are a tag mapping assistant for SillyTavern. You receive a list of unmapped embedded character card tags (with their prevalence counts) and the list of existing SillyTavern tags.

Your job is to suggest mappings from embedded tags to SillyTavern tags. You can map an embedded tag to one or more existing ST tags, suggest that it should map to a new ST tag that doesn't exist yet, or mark it as "do not map" if the tag is too vague or generic to be usefully mapped.

You MUST respond with ONLY valid JSON in this exact format, no other text, no markdown code fences:
{
  "suggestions": [
    {
      "embedded_tag": "tag name",
      "st_tags": ["Existing Tag 1", "Existing Tag 2"],
      "is_new": false,
      "reasoning": "Why this mapping makes sense"
    },
    {
      "embedded_tag": "another tag",
      "st_tags": ["New Tag Name"],
      "is_new": true,
      "new_tag_color": "#hexcolor",
      "new_tag_color2": "#hexcolor",
      "reasoning": "Why this tag should be created"
    },
    {
      "embedded_tag": "vague tag",
      "st_tags": [],
      "is_new": false,
      "do_not_map": true,
      "reasoning": "Why this tag is too vague to map"
    }
  ]
}

Rules:
- Only suggest mappings for tags that meet the minimum prevalence threshold.
- Prefer mapping to existing ST tags when a reasonable match exists (case-insensitive matching is OK).
- Only suggest creating new ST tags when the embedded tag represents a genuinely significant category that doesn't have a comparable existing tag.
- When suggesting a new tag, you MUST provide both new_tag_color and new_tag_color2. new_tag_color is the background color. new_tag_color2 is the foreground (text) color, chosen for contrast against the background. Pick colors that harmonize with existing tag colors of similar type.
- If an embedded tag is too vague, generic, or ambiguous to be usefully mapped (e.g., "roleplay", "story", "character"), set do_not_map to true and leave st_tags empty. This tells the system to skip this tag in the future.
- If two tags have overlapping but distinct meanings (e.g., "Fantasy" and "Dark Fantasy"), keep them as separate suggestions rather than collapsing them. Only merge when they are truly synonymous.
- An embedded tag can map to multiple ST tags (e.g., "vampire" → ["Supernatural", "Dark Theme"]).
- Keep suggestions practical and focused.`;

const MAPPING_SUGGEST_SYSTEM_PROMPT_NO_COLORS = MAPPING_SUGGEST_SYSTEM_PROMPT.replace('you MUST provide both new_tag_color and new_tag_color2. new_tag_color is the background color. new_tag_color2 is the foreground (text) color, chosen for contrast against the background. ', '');

function extractJsonFromResponse(text) {
    let cleaned = text.trim();

    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    const braceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        return JSON.parse(braceMatch[0]);
    }

    throw new Error('No JSON object found in response');
}

export class LlmTagger {
    async analyze(character, options = {}) {
        const { profileId, fields = [], maxTokens, requireColors = true } = options;
        const resolvedMaxTokens = maxTokens ?? this.getProfileMaxTokens(profileId);
        const entityKey = getTagKeyForEntity(character.avatar);
        const currentTagIds = entityKey ? (tag_map[entityKey] ?? []) : [];
        const currentTagNames = currentTagIds
            .map(id => tags.find(t => t.id === id))
            .filter(Boolean)
            .map(t => t.name);

        const mappingManager = new TagMappingManager();
        const mappingProposals = mappingManager.applyMappings(character);
        const mappedTagNames = mappingProposals.map(p => p.tagName);

        const existingTagsList = tags.map(t => {
            const assigned = currentTagNames.includes(t.name) || mappedTagNames.includes(t.name);
            if (assigned) return null;
            const bg = t.color || 'none';
            const fg = t.color2 || 'none';
            return `${t.name} (bg:${bg}, fg:${fg})`;
        }).filter(Boolean);

        const cardText = this.buildCardText(character, fields);
        const embeddedTags = (character.tags ?? []).filter(t => t && !['ROOT', 'TAVERN'].includes(t));

        const userPrompt = `${cardText}\n\nExisting embedded tags: ${embeddedTags.join(', ') || 'None'}\n\nAvailable SillyTavern tags (not yet assigned to this character):\n${existingTagsList.join('\n') || 'None'}`;

        const systemPrompt = requireColors ? SYSTEM_PROMPT : SYSTEM_PROMPT_NO_COLORS;

        const responseText = await this.sendLlmRequest(profileId, systemPrompt, userPrompt, resolvedMaxTokens);
        if (responseText === null) return [];

        return this.parseResponse(responseText, character, currentTagNames);
    }

    async suggestMappings(unmappedTags, options = {}) {
        const { profileId, maxTokens, requireColors = true, onProgress } = options;
        const resolvedMaxTokens = maxTokens ?? this.getProfileMaxTokens(profileId);

        const existingTagsList = tags.map(t => {
            const bg = t.color || 'none';
            const fg = t.color2 || 'none';
            return `${t.name} (bg:${bg}, fg:${fg})`;
        });
        const tagListStr = existingTagsList.join('\n') || 'None';

        const embeddedTagsStr = unmappedTags
            .map(t => `${t.name} (${t.count} characters)`)
            .join('\n');

        const userPrompt = `Unmapped embedded tags:\n${embeddedTagsStr}\n\nExisting SillyTavern tags:\n${tagListStr}`;

        const systemPrompt = requireColors ? MAPPING_SUGGEST_SYSTEM_PROMPT : MAPPING_SUGGEST_SYSTEM_PROMPT_NO_COLORS;

        const responseText = await this.sendLlmRequest(profileId, systemPrompt, userPrompt, resolvedMaxTokens, onProgress);
        if (responseText === null) return [];

        return this.parseMappingSuggestions(responseText, unmappedTags);
    }

    async sendLlmRequest(profileId, systemPrompt, userPrompt, maxTokens, onProgress) {
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ];

        try {
            const streamResponse = await ConnectionManagerRequestService.sendRequest(
                profileId,
                messages,
                maxTokens,
                { stream: true, extractData: true, includePreset: true, includeInstruct: false },
            );

            if (typeof streamResponse === 'function') {
                let fullText = '';
                let thinkingText = '';
                const generator = streamResponse();
                for await (const chunk of generator) {
                    if (chunk.text) fullText = chunk.text;
                    if (chunk.state?.reasoning) thinkingText = chunk.state.reasoning;
                    onProgress?.({ tokens: fullText.length, thinkingTokens: thinkingText.length, streaming: true });
                }
                return fullText;
            }

            const extracted = streamResponse;
            return extracted?.content ?? extracted?.message ?? extracted?.text ?? JSON.stringify(extracted);
        } catch (err) {
            console.warn('Tag Automation: Streaming request failed, trying non-streaming', err);
        }

        try {
            onProgress?.({ tokens: 0, thinkingTokens: 0, streaming: false, waiting: true });
            const data = await ConnectionManagerRequestService.sendRequest(
                profileId,
                messages,
                maxTokens,
                { stream: false, extractData: true, includePreset: true, includeInstruct: false },
            );
            const result = typeof data === 'string' ? data : data?.content ?? data?.message ?? data?.text ?? JSON.stringify(data);
            onProgress?.({ tokens: result?.length ?? 0, thinkingTokens: 0, streaming: false, done: true });
            return result;
        } catch (err) {
            console.error('Tag Automation: LLM request failed', err);
            return null;
        }
    }

    buildCardText(character, fields) {
        const parts = [`Character: ${character.name || 'Unknown'}`];

        if (character.description) {
            parts.push(`Description: ${character.description}`);
        }
        if (character.personality) {
            parts.push(`Personality: ${character.personality}`);
        }
        if (fields.includes('scenario') && character.scenario) {
            parts.push(`Scenario: ${character.scenario}`);
        }
        if (fields.includes('first_mes') && character.first_mes) {
            parts.push(`First Message: ${character.first_mes}`);
        }
        if (fields.includes('mes_example') && character.mes_example) {
            parts.push(`Message Examples: ${character.mes_example}`);
        }
        if (fields.includes('creator_notes') && character.creator_notes) {
            parts.push(`Creator Notes: ${character.creator_notes}`);
        }
        if (fields.includes('character_book') && character.character_book) {
            const entries = (character.character_book.entries ?? [])
                .map(e => e.content)
                .filter(Boolean)
                .join('\n');
            if (entries) {
                parts.push(`Character Book: ${entries}`);
            }
        }

        return parts.join('\n\n');
    }

    parseResponse(responseText, character, currentTagNames) {
        let parsed;
        try {
            parsed = extractJsonFromResponse(responseText);
        } catch {
            console.error('Tag Automation: Could not parse LLM response', responseText);
            return [];
        }

        const proposals = [];

        const matchedTags = Array.isArray(parsed.matched_tags) ? parsed.matched_tags : [];
        for (const tagName of matchedTags) {
            if (typeof tagName !== 'string') continue;
            const normalizedName = tagName.trim();
            if (!normalizedName) continue;
            if (currentTagNames.some(ct => ct.toLowerCase() === normalizedName.toLowerCase())) continue;

            const existingTag = this.findTagByName(normalizedName);
            proposals.push({
                type: existingTag ? 'llm_matched' : 'llm_new',
                characterName: character.name,
                characterAvatar: character.avatar,
                tagName: existingTag ? existingTag.name : normalizedName,
                tagId: existingTag?.id ?? null,
                isNewTag: !existingTag,
                color: existingTag?.color ?? null,
                color2: existingTag?.color2 ?? null,
                reasoning: parsed.reasoning ?? '',
            });
        }

        const newTags = Array.isArray(parsed.new_tags) ? parsed.new_tags : [];
        for (const newTag of newTags) {
            if (!newTag?.name || typeof newTag.name !== 'string') continue;
            const normalizedName = newTag.name.trim();
            if (!normalizedName) continue;
            if (currentTagNames.some(ct => ct.toLowerCase() === normalizedName.toLowerCase())) continue;
            if (proposals.some(p => p.tagName.toLowerCase() === normalizedName.toLowerCase())) continue;

            const existingTag = this.findTagByName(normalizedName);
            proposals.push({
                type: 'llm_new',
                characterName: character.name,
                characterAvatar: character.avatar,
                tagName: existingTag ? existingTag.name : normalizedName,
                tagId: existingTag?.id ?? null,
                isNewTag: !existingTag,
                color: existingTag?.color ?? newTag.color ?? null,
                color2: existingTag?.color2 ?? newTag.color2 ?? '#ffffff',
                reasoning: parsed.reasoning ?? '',
            });
        }

        return proposals;
    }

    parseMappingSuggestions(responseText, unmappedTags) {
        let parsed;
        try {
            parsed = extractJsonFromResponse(responseText);
        } catch {
            console.error('Tag Automation: Could not parse LLM mapping suggestion response', responseText);
            return [];
        }

        if (!parsed || !Array.isArray(parsed.suggestions)) return [];

        const suggestions = [];
        const unmappedLookup = new Map(unmappedTags.map(t => [t.name.toLowerCase(), t]));

        for (const suggestion of parsed.suggestions) {
            if (!suggestion?.embedded_tag || typeof suggestion.embedded_tag !== 'string') continue;
            const key = suggestion.embedded_tag.trim().toLowerCase();
            if (!key) continue;

            const tagInfo = unmappedLookup.get(key);
            if (!tagInfo) continue;

            const isDoNotMap = !!suggestion.do_not_map;
            const stTagNames = Array.isArray(suggestion.st_tags)
                ? suggestion.st_tags.map(t => String(t).trim()).filter(t => t)
                : [];

            if (isDoNotMap) {
                suggestions.push({
                    embeddedTag: tagInfo.name,
                    count: tagInfo.count,
                    stTagNames: [],
                    isNewTag: false,
                    newTagColor: null,
                    newTagColor2: '#ffffff',
                    doNotMap: true,
                    reasoning: suggestion.reasoning ?? '',
                });
                continue;
            }

            if (stTagNames.length === 0) continue;

            const normalizedStTags = stTagNames.map(name => {
                const existing = this.findTagByName(name);
                return existing ? existing.name : name;
            });

            const isNew = !!suggestion.is_new;
            const hasNewTag = normalizedStTags.some(name => !this.findTagByName(name));

            suggestions.push({
                embeddedTag: tagInfo.name,
                count: tagInfo.count,
                stTagNames: normalizedStTags,
                isNewTag: isNew || hasNewTag,
                newTagColor: suggestion.new_tag_color ?? null,
                newTagColor2: suggestion.new_tag_color2 ?? '#ffffff',
                doNotMap: false,
                reasoning: suggestion.reasoning ?? '',
            });
        }

        return suggestions;
    }

    findTagByName(name) {
        const lower = name.toLowerCase();
        return tags.find(t => t.name.toLowerCase() === lower) ?? null;
    }

    getProfileMaxTokens(profileId) {
        const context = SillyTavern.getContext();
        if (!profileId) {
            return context.chatCompletionSettings?.openai_max_tokens ?? 1024;
        }
        try {
            const profile = ConnectionManagerRequestService.getProfile(profileId);
            const apiMap = context.CONNECT_API_MAP[profile.api];
            if (apiMap?.selected === 'openai') {
                return context.chatCompletionSettings?.openai_max_tokens ?? 1024;
            }
            return 1024;
        } catch {
            return 1024;
        }
    }
}
