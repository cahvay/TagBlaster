# TagBlaster

*In the beginning, user-defined tagging was created. This has made a lot of people very angry, and been widely regarded as a bad move.*

TagBlaster is a SillyTavern extension for people who are tired of seeing fifty different ways to spell "bara wolf" across their character collection. It automates the tedious and error-prone process of mapping embedded card tags to actual SillyTavern tags, so you don't have to manually fix every card someone else decided to tag their own special way.

## What it does

- **Tag mappings**: Map any embedded tag (the junk inside character cards) to one or more ST tags. Example: map `bara_werewolf` → Bara, Werewolf
- **Case-insensitive matching**: `Gay`, `gay`, and `GAY` are all the same tag.
- **Blocked tags**: Tag names so vague or useless that importing them would be actively harmful can be blacklisted entirely
- **LLM-powered suggestions**: Point it at your unmapped tags and it will suggest sensible mappings using your configured LLM profile
- **Silent auto-import**:  When you import tags from a card, mapped tags are applied automatically (based on your Import Card Tags setting) without extra clicks
- **Bulk operations**: Apply all configured mappings across multiple characters at once

## How to use it

1. Open any character's settings panel and browse down to **TagBlaster** under Extensions
2. Create mappings in the **Tag Mappings** section:
   - Enter the embedded tag name (the junk written on the card)
   - Enter the ST tag name(s) you want it mapped to
   - Leave the ST tag field blank to block the tag entirely
3. Use the "Import Unmapped Embedded Tags" button to find tags across your collection that nobody has mapped yet
4. If a tag is too vague to map meaningfully ("character", "story", "roleplay"), put it in the blocked list

Mapped tags will be applied automatically whenever you use SillyTavern's built-in "Import Tags" feature from a character's menu, or from the bulk tag editor.

### LLM Mapping Suggestions

If you have a lot of unmapped tags and don't want to hand-write every mapping:

1. Pick a **Connection Profile** in the settings (the same LLM you chat with is fine)
2. Click **Import Unmapped Embedded Tags**
3. Click the **LLM Suggest** button
4. TagBlaster sends your unmapped tags to the LLM and asks it to propose sensible ST equivalents, complete with colors
5. Review the suggestions in the popup; they're grouped by target tag, with checkboxes per source tag
6. Accept the ones you want, reject the junk, and save

Tags the LLM thinks are too vague to map meaningfully can be flagged as **Do Not Map** right from the suggestion UI.

## Settings

- **Connection Profile**: Which LLM profile to use when asking the AI for mapping suggestions. Needs a working Connection Manager setup.
- **Require colors for new tags**: When the LLM suggests creating a brand new tag, it must also propose a color. Off means you get plain tags.
