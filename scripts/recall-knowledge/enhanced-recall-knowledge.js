/**
 * Enhanced Quick Recall Knowledge Macro for PF2e
 * 
 * Features:
 * - Rolls for selected tokens or the whole party.
 * - Player view asks for specific questions (Weaknesses, Saves, etc.) only when targeting.
 * - GM view retrieves all information at once, plus rolls for related skills.
 * - Analyzes targeted enemies to provide contextual hints (Truths & Lies).
 * - Shares the primary d20 roll across all related skill checks.
 * - Dynamically detects Special Lores (Esoteric, Loremaster, Bardic) via fuzzy matching.
 * - Auto-Injects all specific player lores (Undead, Scouting, etc.) into the dropdown.
 * - Smart Suggestions: Auto-recommends Universal Lores on ties or missing traits.
 * - Automatically applies RAW penalties for Diverse Lore on non-creature topics.
 * - Player blind roll prioritizes selected skill and shows ALL skills (including custom lores) as secondary.
 * - Module Settings integration for UI, failure states, and auto-replying.
 * - Allows manual situational modifiers via UI slider.
 */

export const ENHANCED_RECALL_MACRO_NAME = "Enhanced Recall Knowledge";
export const ENHANCED_RECALL_MACRO_ICON = "icons/sundries/documents/blueprint-recipe-alchemical.webp";

const MODULE_ID = "pf2e-awesome-macros-for-players";
const CUSTOM_QUESTIONS_SETTING_KEY = "customRecallQuestions";
const QUESTIONS_CHANGED_HOOK = "pf2eAwesomeRecallQuestionsChanged";

export const RK_INFO_FIELD = Object.freeze({
    WEAKNESSES: "weaknesses",
    RESISTANCES: "resistances",
    IMMUNITIES: "immunities",
    LOWEST_SAVE: "lowestSave",
    HIGHEST_SAVE: "highestSave",
    SAVES: "saves",
    ABILITIES: "abilities",
    ATTACKS: "attacks",
    OTHER: "other"
});

const RK_MAPPABLE_FIELDS = Object.freeze([
    { key: RK_INFO_FIELD.WEAKNESSES, label: "Weaknesses" },
    { key: RK_INFO_FIELD.RESISTANCES, label: "Resistances" },
    { key: RK_INFO_FIELD.IMMUNITIES, label: "Immunities" },
    { key: RK_INFO_FIELD.LOWEST_SAVE, label: "Lowest Save" },
    { key: RK_INFO_FIELD.HIGHEST_SAVE, label: "Highest Save" },
    { key: RK_INFO_FIELD.ABILITIES, label: "Special Abilities" },
    { key: RK_INFO_FIELD.ATTACKS, label: "Attacks" }
]);

const VALID_MAPPABLE_FIELD_KEYS = new Set(RK_MAPPABLE_FIELDS.map(f => f.key));

const FIELD_LABELS = Object.freeze({
    ...Object.fromEntries(RK_MAPPABLE_FIELDS.map(f => [f.key, f.label])),
    [RK_INFO_FIELD.SAVES]: "Lowest/Highest Saves",
    [RK_INFO_FIELD.OTHER]: "Custom (GM Discretion)"
});

export const DEFAULT_RECALL_QUESTIONS = Object.freeze([
    Object.freeze({ id: "weaknesses", label: "Weaknesses", fields: Object.freeze([RK_INFO_FIELD.WEAKNESSES]) }),
    Object.freeze({ id: "resistances", label: "Resistances", fields: Object.freeze([RK_INFO_FIELD.RESISTANCES]) }),
    Object.freeze({ id: "immunities", label: "Immunities", fields: Object.freeze([RK_INFO_FIELD.IMMUNITIES]) }),
    Object.freeze({ id: "saves", label: "Lowest/Highest Saves", fields: Object.freeze([RK_INFO_FIELD.LOWEST_SAVE, RK_INFO_FIELD.HIGHEST_SAVE]) }),
    Object.freeze({ id: "abilities", label: "Special Abilities", fields: Object.freeze([RK_INFO_FIELD.ABILITIES]) }),
    Object.freeze({ id: "attacks", label: "Attacks", fields: Object.freeze([RK_INFO_FIELD.ATTACKS]) })
]);

function getSetting(key, defaultValue) {
    try { return game.settings.get(MODULE_ID, key); }
    catch (e) { return defaultValue; }
}

function createQuestionId() {
    if (globalThis.foundry?.utils?.randomID) {
        return `q_${foundry.utils.randomID(8)}`;
    }
    return `q_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFieldList(rawFields) {
    if (!Array.isArray(rawFields)) return [];
    const expanded = [];
    for (const field of rawFields) {
        if (field === RK_INFO_FIELD.SAVES) {
            expanded.push(RK_INFO_FIELD.LOWEST_SAVE, RK_INFO_FIELD.HIGHEST_SAVE);
        } else if (VALID_MAPPABLE_FIELD_KEYS.has(field)) {
            expanded.push(field);
        }
    }
    return Array.from(new Set(expanded));
}

function sanitizeRecallQuestions(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seenIds = new Set();
    const cleaned = [];

    for (const item of rawList) {
        if (!item || typeof item !== "object") continue;
        const label = String(item.label ?? "").trim();
        const fields = normalizeFieldList(item.fields);
        if (!label || fields.length === 0) continue;

        let id = String(item.id ?? "").trim() || createQuestionId();
        while (seenIds.has(id)) {
            id = createQuestionId();
        }
        seenIds.add(id);
        cleaned.push({ id, label, fields });
    }

    return cleaned;
}

export function getConfiguredRecallQuestions() {
    const saved = getSetting(CUSTOM_QUESTIONS_SETTING_KEY, null);
    const sanitized = sanitizeRecallQuestions(saved);
    if (sanitized.length > 0) return sanitized;
    return DEFAULT_RECALL_QUESTIONS.map(q => ({
        id: q.id,
        label: q.label,
        fields: [...q.fields]
    }));
}

function resolveSelectedQuestion(questionValue, otherText) {
    if (!questionValue || questionValue === "all") {
        return {
            id: "all",
            label: "General Info",
            isAll: true,
            isOther: false,
            fields: []
        };
    }

    if (questionValue === RK_INFO_FIELD.OTHER) {
        return {
            id: RK_INFO_FIELD.OTHER,
            label: (otherText || "").trim() || "Other",
            isAll: false,
            isOther: true,
            fields: [RK_INFO_FIELD.OTHER]
        };
    }

    const configured = getConfiguredRecallQuestions().find(q => q.id === questionValue);
    if (configured) {
        return {
            id: configured.id,
            label: configured.label,
            isAll: false,
            isOther: false,
            fields: [...configured.fields]
        };
    }

    // Backwards-compatible fallback if a raw stat field key (e.g. "weaknesses" or "saves") was passed directly
    if (FIELD_LABELS[questionValue]) {
        return {
            id: questionValue,
            label: FIELD_LABELS[questionValue],
            isAll: false,
            isOther: false,
            fields: [questionValue]
        };
    }

    return {
        id: "all",
        label: "General Info",
        isAll: true,
        isOther: false,
        fields: []
    };
}

const BaseApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {};

/**
 * ApplicationV2 settings menu allowing Gamemasters and Assistant Gamemasters to configure
 * world-shared custom Recall Knowledge questions mapped to one or more stat/info fields.
 */
export class RecallKnowledgeQuestionConfigApp extends BaseApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "pf2e-rk-question-config",
        classes: ["pf2e-rk-question-config-app"],
        window: {
            title: "Configure Recall Knowledge Questions",
            icon: "fas fa-question-circle",
            resizable: true
        },
        position: {
            width: 680,
            height: "auto"
        }
    };

    constructor(options = {}) {
        super(options);
        this._draftQuestions = null;
    }

    render(options = {}, _legacyOptions = {}) {
        if (!game.user?.isGM) {
            ui.notifications?.warn("Only a Gamemaster or Assistant Gamemaster can configure Recall Knowledge questions.");
            return this;
        }
        if (typeof options === "boolean") {
            options = { force: options };
        }
        return super.render(options, _legacyOptions);
    }

    async _prepareContext(_options) {
        if (!this._draftQuestions) {
            this._draftQuestions = getConfiguredRecallQuestions().map(q => ({
                id: q.id,
                label: q.label,
                fields: [...q.fields]
            }));
        }
        return {
            questions: this._draftQuestions,
            availableFields: RK_MAPPABLE_FIELDS
        };
    }

    async _renderHTML(context, _options) {
        const container = document.createElement("div");
        container.className = "rk-question-config-body";
        container.style.cssText = "display: flex; flex-direction: column; gap: 10px; padding: 6px 4px; font-family: 'Signika', sans-serif;";

        const rowsHtml = context.questions.length > 0
            ? context.questions.map((q, idx) => {
                const selectedSet = new Set(q.fields);
                const checkboxesHtml = context.availableFields.map(f => {
                    const checked = selectedSet.has(f.key) ? "checked" : "";
                    return `
                        <label style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.85em; cursor: pointer; user-select: none;">
                            <input type="checkbox" class="rk-cfg-field-checkbox" data-field="${escapeHtml(f.key)}" ${checked} style="margin: 0;" />
                            <span>${escapeHtml(f.label)}</span>
                        </label>
                    `;
                }).join("");

                const disableUp = idx === 0 ? "disabled" : "";
                const disableDown = idx === context.questions.length - 1 ? "disabled" : "";

                return `
                    <div class="rk-cfg-row" data-row-index="${idx}" data-question-id="${escapeHtml(q.id)}" style="border: 1px solid rgba(128,128,128,0.35); border-radius: 5px; padding: 8px 10px; background: rgba(128,128,128,0.06); display: flex; flex-direction: column; gap: 7px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="text" class="rk-cfg-label-input" value="${escapeHtml(q.label)}" placeholder="Enter question text (e.g. What is this creature vulnerable to?)" style="flex: 1; height: 28px; padding: 2px 8px;" />
                            <button type="button" class="rk-cfg-move-up" title="Move Up" ${disableUp} style="width: 30px; height: 28px; flex: 0 0 auto; cursor: pointer;">Up</button>
                            <button type="button" class="rk-cfg-move-down" title="Move Down" ${disableDown} style="width: 42px; height: 28px; flex: 0 0 auto; cursor: pointer;">Down</button>
                            <button type="button" class="rk-cfg-delete" title="Remove Question" style="width: auto; height: 28px; padding: 0 8px; flex: 0 0 auto; cursor: pointer; color: #c62828;">Remove</button>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px 8px; padding-left: 2px;">
                            ${checkboxesHtml}
                        </div>
                    </div>
                `;
            }).join("")
            : `<div style="text-align: center; padding: 18px; opacity: 0.75; font-style: italic;">No custom questions configured. Click "Add Question" or "Reset Defaults".</div>`;

        container.innerHTML = `
            <p style="margin: 0; font-size: 0.88em; line-height: 1.35; opacity: 0.9;">
                Customize the questions shown in the Recall Knowledge dropdown and map each question to one or more stat fields revealed in chat.
            </p>
            <div class="rk-cfg-rows-scroll" style="max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
                ${rowsHtml}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 6px; border-top: 1px solid rgba(128,128,128,0.3); flex-wrap: wrap;">
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="rk-cfg-add-btn" style="width: auto; flex: 0 0 auto; padding: 4px 12px; cursor: pointer;">Add Question</button>
                    <button type="button" class="rk-cfg-reset-btn" style="width: auto; flex: 0 0 auto; padding: 4px 12px; cursor: pointer;">Reset Defaults</button>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button type="button" class="rk-cfg-cancel-btn" style="width: auto; flex: 0 0 auto; padding: 4px 12px; cursor: pointer;">Cancel</button>
                    <button type="button" class="rk-cfg-save-btn" style="width: auto; flex: 0 0 auto; padding: 4px 14px; font-weight: bold; cursor: pointer;">Save Questions</button>
                </div>
            </div>
        `;

        return container;
    }

    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _syncDraftFromDom() {
        const root = this.element?.querySelector(".rk-question-config-body");
        if (!root) return [];

        const rows = root.querySelectorAll(".rk-cfg-row");
        const nextDraft = [];
        rows.forEach((row) => {
            const id = row.dataset.questionId || createQuestionId();
            const label = row.querySelector(".rk-cfg-label-input")?.value ?? "";
            const fields = [];
            row.querySelectorAll(".rk-cfg-field-checkbox:checked").forEach((cb) => {
                if (cb.dataset.field) fields.push(cb.dataset.field);
            });
            nextDraft.push({ id, label, fields });
        });

        this._draftQuestions = nextDraft;
        return nextDraft;
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const root = this.element?.querySelector(".rk-question-config-body");
        if (!root) return;

        root.querySelectorAll(".rk-cfg-move-up").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const draft = this._syncDraftFromDom();
                const idx = Number(btn.closest(".rk-cfg-row")?.dataset.rowIndex);
                if (idx > 0 && idx < draft.length) {
                    [draft[idx - 1], draft[idx]] = [draft[idx], draft[idx - 1]];
                    this.render({ force: false });
                }
            });
        });

        root.querySelectorAll(".rk-cfg-move-down").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const draft = this._syncDraftFromDom();
                const idx = Number(btn.closest(".rk-cfg-row")?.dataset.rowIndex);
                if (idx >= 0 && idx < draft.length - 1) {
                    [draft[idx], draft[idx + 1]] = [draft[idx + 1], draft[idx]];
                    this.render({ force: false });
                }
            });
        });

        root.querySelectorAll(".rk-cfg-delete").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                const draft = this._syncDraftFromDom();
                const idx = Number(btn.closest(".rk-cfg-row")?.dataset.rowIndex);
                if (idx >= 0 && idx < draft.length) {
                    draft.splice(idx, 1);
                    this.render({ force: false });
                }
            });
        });

        root.querySelector(".rk-cfg-add-btn")?.addEventListener("click", async (e) => {
            e.preventDefault();
            const draft = this._syncDraftFromDom();
            draft.push({
                id: createQuestionId(),
                label: "",
                fields: [RK_INFO_FIELD.WEAKNESSES]
            });
            await this.render({ force: false });
            const inputs = this.element?.querySelectorAll(".rk-cfg-label-input");
            inputs?.[inputs.length - 1]?.focus();
        });

        root.querySelector(".rk-cfg-reset-btn")?.addEventListener("click", (e) => {
            e.preventDefault();
            this._draftQuestions = DEFAULT_RECALL_QUESTIONS.map(q => ({
                id: q.id,
                label: q.label,
                fields: [...q.fields]
            }));
            this.render({ force: false });
        });

        root.querySelector(".rk-cfg-cancel-btn")?.addEventListener("click", (e) => {
            e.preventDefault();
            this.close();
        });

        root.querySelector(".rk-cfg-save-btn")?.addEventListener("click", async (e) => {
            e.preventDefault();
            if (!game.user?.isGM) {
                ui.notifications.warn("Only a Gamemaster or Assistant Gamemaster can save Recall Knowledge questions.");
                return;
            }
            const draft = this._syncDraftFromDom();

            if (draft.length === 0) {
                ui.notifications.warn("Please keep at least one question before saving (or use Reset Defaults).");
                return;
            }

            for (let i = 0; i < draft.length; i++) {
                const entry = draft[i];
                if (!entry.label.trim()) {
                    ui.notifications.warn(`Question #${i + 1} needs a question text label.`);
                    return;
                }
                if (!entry.fields.length) {
                    ui.notifications.warn(`"${entry.label.trim()}" must map to at least one stat field.`);
                    return;
                }
            }

            const cleaned = sanitizeRecallQuestions(draft);
            await game.settings.set(MODULE_ID, CUSTOM_QUESTIONS_SETTING_KEY, cleaned);
            Hooks.callAll(QUESTIONS_CHANGED_HOOK, cleaned);
            ui.notifications.info(`Saved ${cleaned.length} Recall Knowledge question${cleaned.length === 1 ? "" : "s"}.`);
            this.close();
        });
    }

    async close(options = {}) {
        this._draftQuestions = null;
        return super.close(options);
    }
}

const SKILL_DICTIONARY = { 'arcana': 'Arcana', 'crafting': 'Crafting', 'nature': 'Nature', 'occultism': 'Occultism', 'religion': 'Religion', 'society': 'Society', 'medicine': 'Medicine', 'athletics': 'Athletics', 'acrobatics': 'Acrobatics', 'stealth': 'Stealth', 'lore': 'Lore (Generic)' };

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function calculateDegreeOfSuccess(total, dc, d20) {
    if (dc === null) return 'Unknown';

    const difference = total - dc;
    let degreeValue = 0;
    if (difference >= 10) degreeValue = 3;
    else if (difference >= 0) degreeValue = 2;
    else if (difference >= -9) degreeValue = 1;
    else degreeValue = 0;

    if (d20 === 20) degreeValue = Math.min(3, degreeValue + 1);
    else if (d20 === 1) degreeValue = Math.max(0, degreeValue - 1);

    const degreeNames = ['Critical Failure', 'Failure', 'Success', 'Critical Success'];
    return degreeNames[degreeValue];
}

function calculateRKDC(targetActor) {
    if (!targetActor || targetActor.type !== 'npc') return 15;
    const level = targetActor.system?.details?.level?.value || 0;
    const rarity = targetActor.system?.traits?.rarity || 'common';

    const dcs = {
        "-1": 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22,
        7: 23, 8: 24, 9: 26, 10: 27, 11: 28, 12: 30, 13: 31, 14: 32,
        15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40, 21: 42,
        22: 44, 23: 46, 24: 48, 25: 50
    };
    let dc = dcs[level] !== undefined ? dcs[level] : (14 + level * 1.3);

    if (rarity === 'uncommon') dc += 2;
    else if (rarity === 'rare') dc += 5;
    else if (rarity === 'unique') dc += 10;

    return Math.floor(dc);
}

async function analyzeCreature(targetActor) {
    if (!targetActor) return null;

    const attrs = targetActor.system?.attributes || {};
    const weaknesses = attrs.weaknesses || [];
    const resistances = attrs.resistances || [];
    const immunities = attrs.immunities || [];

    const saves = targetActor.system?.saves || {};
    const saveMap = [
        { name: 'Fortitude', value: saves.fortitude?.value || 0 },
        { name: 'Reflex', value: saves.reflex?.value || 0 },
        { name: 'Will', value: saves.will?.value || 0 }
    ].sort((a, b) => b.value - a.value);
    const highestSave = saveMap[0]?.name || 'Unknown';
    const lowestSave = saveMap[2]?.name || 'Unknown';

    const items = targetActor.items || [];
    const hasSpells = items.some(i => i.type === 'spell' || i.type === 'spellcastingEntry');
    const abilities = items.filter(i => i.type === 'action').map(i => i.name).filter(n => n && n.length > 2);
    if (hasSpells) abilities.push("can cast spells");

    const attacks = items.filter(i => i.type === 'melee' || i.type === 'weapon').map(i => i.name).filter(n => n && n.length > 2);

    const shuffledAbilities = abilities.sort(() => 0.5 - Math.random());
    const shuffledAttacks = attacks.sort(() => 0.5 - Math.random());

    const truths = {
        weaknesses: weaknesses.map(w => `${w.type} (${w.value})`),
        resistances: resistances.map(r => `${r.type} (${r.value})`),
        immunities: immunities.map(i => i.type),
        highestSave: highestSave,
        lowestSave: lowestSave,
        abilities: shuffledAbilities.slice(0, 3),
        attacks: shuffledAttacks.slice(0, 3)
    };

    const allDamageTypes = ['acid', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'void', 'vitality', 'spirit', 'cold iron', 'silver', 'precision', 'physical'];
    const realWeaknesses = weaknesses.map(w => (w.type || '').toLowerCase());
    const realResistances = resistances.map(r => (r.type || '').toLowerCase());
    const realImmunities = immunities.map(i => (i.type || '').toLowerCase());

    const getFakeType = (realList, preferredType = null) => {
        if (preferredType && !realList.includes(preferredType)) return preferredType;
        const filtered = allDamageTypes.filter(t => !realList.includes(t));
        return filtered[Math.floor(Math.random() * filtered.length)] || 'bludgeoning';
    };

    const getOpposite = (type) => {
        const opposites = {
            'fire': 'cold', 'cold': 'fire', 'acid': 'poison', 'poison': 'acid', 'electricity': 'sonic', 'sonic': 'electricity',
            'spirit': 'physical', 'physical': 'spirit', 'mental': 'precision', 'precision': 'mental', 'cold iron': 'silver', 'silver': 'cold iron',
            'vitality': 'void', 'void': 'vitality', 'slashing': 'bludgeoning', 'bludgeoning': 'piercing', 'piercing': 'slashing', 'good': 'evil', 'evil': 'good'
        };
        return opposites[(type || '').toLowerCase()];
    };

    const getFakeHighestSave = (realHighest) => realHighest === 'Fortitude' ? 'Reflex' : (realHighest === 'Reflex' ? 'Will' : 'Fortitude');
    const getFakeLowestSave = (realLowest) => realLowest === 'Fortitude' ? 'Reflex' : (realLowest === 'Reflex' ? 'Will' : 'Fortitude');

    let baseFakeWeakness = getFakeType(realWeaknesses);
    let baseFakeImmunity = getFakeType(realImmunities);
    let baseFakeResistance = getFakeType(realResistances);

    if (weaknesses.length > 0) {
        const primary = weaknesses[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, getOpposite(primary));
        baseFakeImmunity = getFakeType(realImmunities, primary);
    } else if (resistances.length > 0) {
        const primary = resistances[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, primary);
        baseFakeResistance = getFakeType(realResistances, getOpposite(primary));
    } else if (immunities.length > 0) {
        const primary = immunities[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, primary);
        baseFakeImmunity = getFakeType(realImmunities, getOpposite(primary));
    }

    let baseFakeAbility = ['Sneak Attack', 'Breath Weapon', 'Rend', 'Swallow Whole'].find(a => !truths.abilities.includes(a)) || "a special ability";
    let baseFakeAttack = ['Jaws', 'Claws', 'Tail', 'Slam'].find(a => !truths.attacks.includes(a)) || "a standard attack";
    let liesArray = [];

    if (targetActor.type === 'npc') {
        const targetTraits = (targetActor.system?.traits?.value || []).filter(t => t.toLowerCase() !== 'humanoid');
        const packs = ['pf2e.pathfinder-monster-core', 'pf2e.pathfinder-monster-core-2', 'pf2e.pathfinder-bestiary', 'pf2e.pathfinder-bestiary-2', 'pf2e.pathfinder-bestiary-3'];
        let possibleEntries = [];

        for (const packKey of packs) {
            const pack = game.packs.get(packKey);
            if (!pack) continue;
            try {
                const index = await pack.getIndex({ fields: ["system.traits.value", "system.traits.rarity", "name"] });
                for (const entry of index) {
                    if (entry.name === targetActor.name) continue;
                    const entryTraits = entry.system?.traits?.value || [];
                    const entryRarity = entry.system?.traits?.rarity || 'common';

                    let matchCount = 0;
                    for (const t of targetTraits) {
                        if (entryTraits.includes(t)) matchCount++;
                    }
                    if (matchCount > 0) possibleEntries.push({ _id: entry._id, pack: packKey, rarity: entryRarity, name: entry.name, score: matchCount });
                }
            } catch (e) {
                console.warn("Recall Knowledge | Could not search pack:", packKey);
            }
        }

        if (possibleEntries.length > 0) {
            possibleEntries.sort((a, b) => b.score - a.score);
            let topMatches = possibleEntries.slice(0, 25);
            let commons = topMatches.filter(e => e.rarity === 'common');
            let uncommons = topMatches.filter(e => e.rarity === 'uncommon');
            let pool = commons.length > 0 ? commons : (uncommons.length > 0 ? uncommons : topMatches);

            let shuffledPool = pool.sort(() => 0.5 - Math.random());
            let chosenList = shuffledPool.slice(0, 3);

            for (const chosen of chosenList) {
                let currentLie = {
                    fakeName: chosen.name,
                    fakeWeakness: baseFakeWeakness,
                    fakeImmunity: baseFakeImmunity,
                    fakeResistance: baseFakeResistance,
                    fakeAbility: baseFakeAbility,
                    fakeAttack: baseFakeAttack,
                    fakeHighSave: getFakeHighestSave(highestSave),
                    fakeLowSave: getFakeLowestSave(lowestSave)
                };

                try {
                    const fakePack = game.packs.get(chosen.pack);
                    const fakeDoc = await fakePack.getDocument(chosen._id);
                    if (fakeDoc) {
                        const fAttrs = fakeDoc.system?.attributes || {};
                        const fWeaknesses = (fAttrs.weaknesses || []).map(w => w.type.toLowerCase());
                        const fImmunities = (fAttrs.immunities || []).map(i => i.type.toLowerCase());
                        const fResistances = (fAttrs.resistances || []).map(r => r.type.toLowerCase());
                        const fItems = fakeDoc.items || [];

                        const fHasSpells = fItems.some(i => i.type === 'spell' || i.type === 'spellcastingEntry');
                        const fActions = fItems.filter(i => i.type === 'action').map(i => i.name).filter(n => n && n.length > 2);
                        if (fHasSpells) fActions.push("can cast spells");

                        const fAttacks = fItems.filter(i => i.type === 'melee' || i.type === 'weapon').map(i => i.name).filter(n => n && n.length > 2);

                        const fSaves = fakeDoc.system?.saves || {};
                        const fSaveMap = [
                            { name: 'Fortitude', value: fSaves.fortitude?.value || 0 }, { name: 'Reflex', value: fSaves.reflex?.value || 0 }, { name: 'Will', value: fSaves.will?.value || 0 }
                        ].sort((a, b) => b.value - a.value);
                        let fHigh = fSaveMap[0]?.name;
                        let fLow = fSaveMap[2]?.name;

                        if (fHigh === highestSave) fHigh = getFakeHighestSave(highestSave);
                        if (fLow === lowestSave) fLow = getFakeLowestSave(lowestSave);
                        currentLie.fakeHighSave = fHigh;
                        currentLie.fakeLowSave = fLow;

                        const validFW = fWeaknesses.filter(w => !realWeaknesses.includes(w));
                        const validFI = fImmunities.filter(i => !realImmunities.includes(i));
                        const validFR = fResistances.filter(r => !realResistances.includes(r));
                        const validFA = fActions.filter(a => !truths.abilities.includes(a));
                        const validFAttacks = fAttacks.filter(a => !truths.attacks.includes(a));

                        if (validFW.length > 0) currentLie.fakeWeakness = validFW[0];
                        if (validFI.length > 0) currentLie.fakeImmunity = validFI[0];
                        if (validFR.length > 0) currentLie.fakeResistance = validFR[0];
                        if (validFA.length > 0) currentLie.fakeAbility = validFA[Math.floor(Math.random() * validFA.length)];
                        if (validFAttacks.length > 0) currentLie.fakeAttack = validFAttacks[Math.floor(Math.random() * validFAttacks.length)];
                    }
                } catch (e) { }
                liesArray.push(currentLie);
            }
        }
    }

    if (liesArray.length === 0) {
        liesArray.push({
            fakeName: "a different creature", fakeWeakness: baseFakeWeakness, fakeImmunity: baseFakeImmunity,
            fakeResistance: baseFakeResistance, fakeAbility: baseFakeAbility, fakeAttack: baseFakeAttack,
            fakeHighSave: getFakeHighestSave(highestSave), fakeLowSave: getFakeLowestSave(lowestSave)
        });
    }

    return { truths, lies: liesArray, name: targetActor.name };
}

function getTruthString(qType, truths, otherText) {
    switch (qType) {
        case RK_INFO_FIELD.WEAKNESSES: return truths.weaknesses.length ? (truths.weaknesses.length > 1 ? `its weaknesses are ${truths.weaknesses.join(', ')}` : `its weakness is ${truths.weaknesses[0]}`) : `it has no specific weaknesses`;
        case RK_INFO_FIELD.RESISTANCES: return truths.resistances.length ? (truths.resistances.length > 1 ? `its resistances are ${truths.resistances.join(', ')}` : `its resistance is ${truths.resistances[0]}`) : `it has no specific resistances`;
        case RK_INFO_FIELD.IMMUNITIES: return truths.immunities.length ? `it is immune to ${truths.immunities.join(', ')}` : `it has no specific immunities`;
        case RK_INFO_FIELD.LOWEST_SAVE: return `its lowest save is ${truths.lowestSave}`;
        case RK_INFO_FIELD.HIGHEST_SAVE: return `its highest save is ${truths.highestSave}`;
        case RK_INFO_FIELD.SAVES: return `its highest save is ${truths.highestSave} and lowest save is ${truths.lowestSave}`;
        case RK_INFO_FIELD.ABILITIES: return truths.abilities.length ? `it has the ability: ${truths.abilities.join(', ')}` : `it has no notable special abilities`;
        case RK_INFO_FIELD.ATTACKS: return truths.attacks.length ? `it attacks using its ${truths.attacks.join(', ')}` : `it uses standard attacks`;
        case RK_INFO_FIELD.OTHER: return `the answer to "${otherText}" is [GM to determine based on statblock]`;
        default: return ``;
    }
}

function getLieString(qType, lie, otherText) {
    switch (qType) {
        case RK_INFO_FIELD.WEAKNESSES: return `its weakness is ${lie.fakeWeakness}`;
        case RK_INFO_FIELD.RESISTANCES: return `its resistance is ${lie.fakeResistance}`;
        case RK_INFO_FIELD.IMMUNITIES: return `it is immune to ${lie.fakeImmunity}`;
        case RK_INFO_FIELD.LOWEST_SAVE: return `its lowest save is ${lie.fakeLowSave}`;
        case RK_INFO_FIELD.HIGHEST_SAVE: return `its highest save is ${lie.fakeHighSave}`;
        case RK_INFO_FIELD.SAVES: return `its highest save is ${lie.fakeHighSave} and lowest save is ${lie.fakeLowSave}`;
        case RK_INFO_FIELD.ABILITIES: return `it has the ability: ${lie.fakeAbility}`;
        case RK_INFO_FIELD.ATTACKS: return `it attacks using its ${lie.fakeAttack}`;
        case RK_INFO_FIELD.OTHER: return `the answer to "${otherText}" is [GM: Make up a lie]`;
        default: return ``;
    }
}

function formatFieldStatementsHtml(fields, resolverFn, prefix = "") {
    if (fields.length <= 1) {
        const statement = resolverFn(fields[0]);
        return escapeHtml(prefix ? `${prefix} ${statement}.` : `${statement}.`);
    }
    return fields.map(fieldKey => {
        const fieldLabel = FIELD_LABELS[fieldKey] || fieldKey;
        const statement = resolverFn(fieldKey);
        const text = prefix ? `${prefix} ${statement}.` : `${statement}.`;
        return `<div><b>${escapeHtml(fieldLabel)}:</b> ${escapeHtml(text)}</div>`;
    }).join("");
}

function getHintForDegree(degree, analysis, selectedQuestion, otherText, hasDubiousKnowledge = false, disableColors = false) {
    if (!analysis) return "<em>No target selected.</em>";
    const { truths, lies, name } = analysis;

    // Manage colors based on settings
    const cCritSucc = disableColors ? '' : 'color:#008800;';
    const cSucc = disableColors ? '' : 'color:#0055aa;';
    const cFail = disableColors ? '' : 'color:#aa5500;';
    const cCritFail = disableColors ? '' : 'color:#aa0000;';

    const trueBg = disableColors ? 'rgba(0,0,0,0.03)' : 'rgba(0, 100, 0, 0.03)';
    const falseBg = disableColors ? 'rgba(0,0,0,0.03)' : 'rgba(100, 0, 0, 0.03)';
    const trueLabel = disableColors ? 'inherit' : '#006600';
    const falseLabel = disableColors ? 'inherit' : '#990000';

    if (selectedQuestion.isAll) {
        const buildGrid = (title, w, r, i, hs, ls, a) => `
            <div style="margin-top: 4px;">
                <div style="font-weight: bold; border-bottom: 1px solid rgba(0,0,0,0.2); margin-bottom: 4px; padding-bottom: 2px;">${escapeHtml(title)}</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 0.95em; line-height: 1.2;">
                    <div><b style="color:#444;">Weak:</b> ${escapeHtml(w)}</div>
                    <div><b style="color:#444;">Resist:</b> ${escapeHtml(r)}</div>
                    <div><b style="color:#444;">Immune:</b> ${escapeHtml(i)}</div>
                    <div><b style="color:#444;">Saves:</b> High ${escapeHtml(hs)} / Low ${escapeHtml(ls)}</div>
                    <div style="grid-column: span 2;"><b style="color:#444;">Ability:</b> ${escapeHtml(a)}</div>
                </div>
            </div>`;

        let truthsHtml = buildGrid(
            name,
            truths.weaknesses.join(', ') || 'None',
            truths.resistances.join(', ') || 'None',
            truths.immunities.join(', ') || 'None',
            truths.highestSave,
            truths.lowestSave,
            truths.abilities.join(', ') || 'None'
        );

        let liesHtml = lies.map((l, idx) => `
            ${idx > 0 ? '<div style="margin-top: 8px; padding-top: 4px; border-top: 1px dashed rgba(0,0,0,0.2);">' : '<div>'}
            ${buildGrid(l.fakeName, l.fakeWeakness, l.fakeResistance, l.fakeImmunity, l.fakeHighSave, l.fakeLowSave, l.fakeAbility)}
            </div>
        `).join('');

        if (degree === 'Critical Success') return `<span style="${cCritSucc}"><b>Reveal Multiple (You are sure that...):</b></span>${truthsHtml}`;
        if (degree === 'Success') return `<span style="${cSucc}"><b>Reveal One (You think that...):</b></span>${truthsHtml}`;
        if (degree === 'Failure') {
            if (hasDubiousKnowledge) {
                return `<span style="${cFail}"><b>Dubious Knowledge (You think that...):</b></span>
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px; color: #222;">
                    <div style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; background: ${trueBg};">
                        <b style="color: ${trueLabel};">True Info:</b>${truthsHtml}
                    </div>
                    <div style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; background: ${falseBg};">
                        <b style="color: ${falseLabel};">False Info Options:</b>${liesHtml}
                    </div>
                </div>`;
            } else {
                return `<span style="${cFail}"><b>Failure:</b> You are not sure about this creature.</span>`;
            }
        }
        if (degree === 'Critical Failure') return `<span style="${cCritFail}"><b>Confident Falsehood (You are sure that...):</b></span><br>${liesHtml}`;
        return "";
    }

    const fields = selectedQuestion.fields;
    const isMultiField = fields.length > 1;
    const renderBlock = (innerHtml) => isMultiField
        ? `<div style="margin-top: 3px; padding-left: 6px; border-left: 2px solid rgba(0,0,0,0.18);">${innerHtml}</div>`
        : `"${innerHtml}"`;

    if (degree === 'Critical Success') {
        const truthBody = formatFieldStatementsHtml(fields, f => getTruthString(f, truths, otherText), "You are sure that");
        return `<span style="${cCritSucc}"><b>Tell them:</b> ${renderBlock(truthBody)}<br><em>(GM: Provide additional contextual information or a second fact.)</em></span>`;
    } else if (degree === 'Success') {
        const truthBody = formatFieldStatementsHtml(fields, f => getTruthString(f, truths, otherText), "You think that");
        return `<span style="${cSucc}"><b>Tell them:</b> ${renderBlock(truthBody)}</span>`;
    } else if (degree === 'Failure') {
        if (hasDubiousKnowledge) {
            const trueHtml = formatFieldStatementsHtml(fields, f => getTruthString(f, truths, otherText), "You think that");
            const optionsHtml = lies.map(l => {
                const lieBody = formatFieldStatementsHtml(fields, f => getLieString(f, l, otherText), "You think that");
                return `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(0,0,0,0.1);">${renderBlock(lieBody)} <br><span style="font-size:0.85em; color:#666;">(Based on ${escapeHtml(l.fakeName)})</span></div>`;
            }).join('');
            return `<span style="${cFail}"><b>Dubious Knowledge:</b></span>
            <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px; color: #222;">
                <div style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; background: ${trueBg};">
                    <b style="color: ${trueLabel};">True Info:</b><br>${trueHtml}
                </div>
                <div style="padding: 6px; border: 1px solid #ccc; border-radius: 4px; background: ${falseBg};">
                    <b style="color: ${falseLabel};">False Info Options:</b>${optionsHtml}
                </div>
            </div>`;
        } else {
            return `<span style="${cFail}"><b>Failure:</b> You are not sure about this creature.</span>`;
        }
    } else if (degree === 'Critical Failure') {
        const optionsHtml = lies.map(l => {
            const lieBody = formatFieldStatementsHtml(fields, f => getLieString(f, l, otherText), "You are sure that");
            return `<div style="margin-top: 4px;">${renderBlock(lieBody)} <br><span style="font-size:0.85em; color:#666;">(Based on ${escapeHtml(l.fakeName)})</span></div>`;
        }).join('');
        return `<span style="${cCritFail}"><b>Confident Falsehood — Pick what to tell them:</b>${optionsHtml}</span>`;
    }
    return "";
}

async function createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis, selectedQuestion, otherText, suggestedSkillLabel, manualBonus) {
    const colorMap = { 'Critical Success': '#00aa00', 'Success': '#0066cc', 'Failure': '#cc6600', 'Critical Failure': '#cc0000', 'Unknown': '#555555' };
    const hideBreakdown = getSetting('hideModifierBreakdown', false);
    const autoReplyOn = getSetting('autoReply', false);
    const disableGMColors = getSetting('disableGMColors', false);

    let rows = '';
    for (const res of results) {
        const p = res.primary;

        // Use grey layout if colors are disabled
        const color = disableGMColors ? '#555555' : (colorMap[p.degree] || '#000000');

        let hintHtml = dc !== null ? getHintForDegree(p.degree, creatureAnalysis, selectedQuestion, otherText, res.hasDubiousKnowledge, disableGMColors) : '<em>No target selected.</em>';
        if (autoReplyOn && dc !== null && !selectedQuestion.isAll) {
            hintHtml += `<br><span style="color:#888; font-size:0.85em;"><em>(Auto-reply pushed to player)</em></span>`;
        }

        let relatedHtml = '';
        if (res.related && res.related.length > 0) {
            relatedHtml = `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed #ccc; font-size: 0.85em; color: #444;">`;
            relatedHtml += `<strong>Related Skills:</strong><br>`;
            relatedHtml += res.related.map(r => {
                const rColor = disableGMColors ? '#555555' : (colorMap[r.degree] || '#000');
                const breakdownStr = hideBreakdown ? '' : ` (${escapeHtml(r.breakdown)})`;
                return `<span>${escapeHtml(r.label)}: <b>${r.total}</b>${breakdownStr} <span style="color:${rColor}; font-weight:bold;">[${r.degree}]</span></span>`;
            }).join(' <br>');
            relatedHtml += `</div>`;
        }

        const pBreakdownStr = hideBreakdown ? '' : ` (${escapeHtml(p.breakdown)})`;

        rows += `
      <div class="recall-knowledge-row" style="border-left: 4px solid ${color}; padding-left:8px; margin-bottom:10px; background: rgba(0,0,0,0.03); padding-top:4px; padding-bottom:4px;">
        <div style="display:flex; justify-content: space-between; align-items: baseline;">
            <strong>${escapeHtml(res.actorName)}</strong>
            <span style="font-size: 0.9em; color:#444; margin-right: 4px;">Primary Skill</span>
        </div>
        <div style="margin-top: 2px;">
            <span>${escapeHtml(p.label)}: <b>${p.total}</b>${pBreakdownStr}</span>
            &nbsp;|&nbsp;
            <span style="color:${color}; font-weight:bold; text-transform:uppercase; font-size:0.9em;">${escapeHtml(p.degree)}</span>
        </div>
        ${relatedHtml}
        <br>
        <div style="margin-top: 6px; font-size: 0.85em; font-family: 'Signika', sans-serif;">
            ${hintHtml}
        </div>
      </div>
    `;
    }

    const mappedFieldsText = (!selectedQuestion.isAll && !selectedQuestion.isOther && selectedQuestion.fields.length > 0)
        ? ` <span style="font-weight: normal; font-size: 0.85em; color: #555;">(${escapeHtml(selectedQuestion.fields.map(f => FIELD_LABELS[f] || f).join(', '))})</span>`
        : '';
    const qTitle = selectedQuestion.label ? `<br>Asked: ${escapeHtml(selectedQuestion.label)}${mappedFieldsText}` : '';

    const dcText = dc !== null ? (suggestedSkillLabel ? `${escapeHtml(suggestedSkillLabel)} <b style="color:#aa0000;">DC ${dc}</b>` : `<b style="color:#aa0000;">DC ${dc}</b>`) : `Unknown DC`;
    const bonusText = manualBonus !== 0 ? `<br><span style="color:#aa0000; font-size: 0.85em;">(Includes ${manualBonus > 0 ? '+' : ''}${manualBonus} manual modifier)</span>` : '';

    const title = creatureName
        ? `Recall Knowledge:<br>${escapeHtml(creatureName)}<br>${dcText}${qTitle}${bonusText}`
        : `Recall Knowledge<br>${dcText}${qTitle}${bonusText}`;

    const content = `<div class="recall-knowledge-result" style="padding:6px; font-family: 'Signika', sans-serif;"><h5 style="border-bottom: 2px solid #333; padding-bottom: 2px;">${title}</h5>${rows}</div>`;
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: null }), content: content, whisper: gmIds, blind: true });
}

function getSkillInfo(actor, skillKey) {
    const systemData = actor.system ?? actor.data?.system ?? {};
    const skills = systemData.skills ?? null;
    if (skills && skills[skillKey]) return skills[skillKey];
    if (skills) {
        const foundKey = Object.keys(skills).find(k => k.toLowerCase() === skillKey.toLowerCase());
        if (foundKey) return skills[foundKey];
    }
    return null;
}

// --- Robustly checks if a skill is a Lore, regardless of its name ---
function isSkillALore(actor, key, skill) {
    if (!skill) return false;

    // 1. Check system flags (Modern PF2e sets this securely)
    if (skill.lore === true || skill.isLore === true) return true;

    // 2. Check string labels as a fallback
    const keyLower = key.toLowerCase();
    const labelLower = (skill.label || "").toLowerCase();
    if (keyLower.includes('lore') || labelLower.includes('lore')) return true;

    // 3. Absolute confirmation: Check if the key matches a mechanical Lore Item on the actor
    if (actor) {
        const loreItems = actor.itemTypes?.lore || Array.from(actor.items || []).filter(i => i.type === 'lore');
        if (loreItems.some(i => i.id === key || i.slug === key || i.system?.slug === key)) return true;
    }

    return false;
}

function getSpecialLores(actor) {
    const specialLores = [];
    if (!actor) return specialLores;

    const systemData = actor.system ?? actor.data?.system ?? {};
    const skills = systemData.skills ?? {};

    for (const [key, skill] of Object.entries(skills)) {
        const label = (skill.label || skill.name || "").toString().toLowerCase().trim();
        const slug = (skill.slug || key || "").toString().toLowerCase().trim();

        const isBardic = label.includes("bardic") || slug.includes("bardic");
        const isLoremaster = label.includes("loremaster") || slug.includes("loremaster");
        const isEsoteric = label.includes("esoteric") || slug.includes("esoteric");

        if (isBardic || isLoremaster || isEsoteric) {
            let hasDiverse = false;

            if (isEsoteric) {
                hasDiverse = actor.items?.some(i => i.type === "feat" && (i.system?.slug === "diverse-lore" || i.slug === "diverse-lore")) || false;
            }

            specialLores.push({
                key: key,
                label: skill.label || "Special Lore",
                isEsoteric: isEsoteric,
                hasDiverse: hasDiverse
            });
        }
    }
    return specialLores;
}

// --- Uses the isSkillALore function ---
function getBestLore(actor, excludeKeys = []) {
    const systemData = actor.system ?? actor.data?.system ?? {};
    const skills = systemData.skills ?? {};
    let best = null;
    let maxMod = -Infinity;
    for (const [key, skill] of Object.entries(skills)) {
        if (isSkillALore(actor, key, skill)) {
            if (excludeKeys.includes(key)) continue;

            const mod = Number(skill.mod ?? skill.value ?? skill.totalModifier ?? skill.total ?? 0);
            if (mod > maxMod) {
                maxMod = mod;
                best = { key, label: skill.label ?? key };
            }
        }
    }
    return best;
}

async function evaluateSkillRoll(actor, skillKey, dc, customLabel = null, forcedD20 = null, circumstanceBonus = 0) {
    const skillInfo = getSkillInfo(actor, skillKey);
    const skillLabel = customLabel || (skillInfo?.label ?? skillKey);
    const baseModifier = Number(skillInfo?.mod ?? skillInfo?.value ?? skillInfo?.totalModifier ?? skillInfo?.total ?? 0);

    const safeModifier = (Number.isFinite(baseModifier) ? baseModifier : 0) + circumstanceBonus;

    let d20Result = forcedD20;
    let total = 0;

    if (d20Result === null) {
        const formula = `1d20 ${safeModifier >= 0 ? '+' : '-'} ${Math.abs(safeModifier)}`;
        let roll;
        try { roll = await new Roll(formula).evaluate(); }
        catch (err) { roll = { total: 0, dice: [] }; }

        try {
            const d20Term = roll.dice?.find(d => d.faces === 20);
            d20Result = d20Term?.results?.[0]?.result ?? null;
        } catch (e) { d20Result = null; }

        total = roll.total;
    } else {
        total = d20Result + safeModifier;
    }

    const degree = dc !== null ? calculateDegreeOfSuccess(total, dc, d20Result) : 'Unknown';
    const modDisplay = safeModifier >= 0 ? `+${safeModifier}` : `${safeModifier}`;
    const breakdown = d20Result !== null ? `${d20Result}${modDisplay}` : total;

    return { label: skillLabel, total: total, d20: d20Result, degree: degree, breakdown: breakdown };
}

// --- Handles the public chat message generation based on target status ---
async function createPublicRecallMessage(actorRolls, hasTarget, selectedQuestion, isGM) {
    const askedStr = (!isGM && hasTarget && !selectedQuestion.isAll)
        ? ` — Question: <b>${escapeHtml(selectedQuestion.isOther ? 'Specific Information' : selectedQuestion.label)}</b>`
        : '';

    let publicContent = `<div class="pf2e chat-card"><header class="card-header flexrow"><h4>Recall Knowledge</h4></header><div class="card-content">`;

    for (const roll of actorRolls) {
        const topicStr = hasTarget ? `the creature` : `a general topic`;
        publicContent += `<p style="margin-bottom: 6px;"><b>${escapeHtml(roll.actorName)}</b> tries to recall information about ${topicStr} using their skill in <b>${escapeHtml(roll.skillLabel)}</b>${askedStr}.</p>`;
    }
    publicContent += `</div></div>`;

    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker(), content: publicContent });
}

function formatAutoReplyFieldsHtml(fields, resolverFn) {
    if (fields.length <= 1) {
        return escapeHtml(resolverFn(fields[0]));
    }
    return `<ul style="margin: 4px 0 4px 18px; padding: 0;">${fields.map(fieldKey => {
        const label = FIELD_LABELS[fieldKey] || fieldKey;
        return `<li><b>${escapeHtml(label)}:</b> ${escapeHtml(resolverFn(fieldKey))}</li>`;
    }).join('')}</ul>`;
}

// --- Sends automated whispers directly to the rolling player ---
async function sendAutoReply(results, selectedQuestion, otherText, analysis) {
    if (!analysis || selectedQuestion.isAll) return;
    const { truths, lies } = analysis;
    const fields = selectedQuestion.fields;

    for (const res of results) {
        const p = res.primary;
        const hasDubious = res.hasDubiousKnowledge;
        const lie = lies[0];

        let html = `<div class="pf2e chat-card">
            <header class="card-header flexrow"><h4>Recall Knowledge Result</h4></header>
            <div class="card-content" style="font-family: 'Signika', sans-serif;">`;

        // Strip inline colors so as not to metagame the success tier
        if (p.degree === 'Critical Success') {
            const askedFieldSet = new Set(fields);
            const bonusPool = RK_MAPPABLE_FIELDS.map(f => f.key).filter(k => !askedFieldSet.has(k));
            const extraCat = bonusPool.length > 0 ? bonusPool[Math.floor(Math.random() * bonusPool.length)] : null;

            html += `<p>You recall this is a <b>${escapeHtml(analysis.name)}</b>.</p>`;
            if (fields.length > 1) {
                html += `<p style="margin-bottom: 2px;"><b>Primary Info:</b></p>${formatAutoReplyFieldsHtml(fields, f => getTruthString(f, truths, otherText))}`;
            } else {
                html += `<p><b>Primary Info:</b> ${formatAutoReplyFieldsHtml(fields, f => getTruthString(f, truths, otherText))}</p>`;
            }
            if (extraCat) {
                const extraLabel = FIELD_LABELS[extraCat] || extraCat;
                html += `<p><b>Bonus Info (${escapeHtml(extraLabel)}):</b> ${escapeHtml(getTruthString(extraCat, truths, otherText))}</p>`;
            }
        } else if (p.degree === 'Success') {
            html += `<p>You recall this is a <b>${escapeHtml(analysis.name)}</b>.</p>`;
            if (fields.length > 1) {
                html += `<p style="margin-bottom: 2px;"><b>Info:</b></p>${formatAutoReplyFieldsHtml(fields, f => getTruthString(f, truths, otherText))}`;
            } else {
                html += `<p><b>Info:</b> ${formatAutoReplyFieldsHtml(fields, f => getTruthString(f, truths, otherText))}</p>`;
            }
        } else if (p.degree === 'Failure') {
            if (hasDubious) {
                const chosenName = Math.random() > 0.5 ? analysis.name : lie.fakeName;
                const formatInlineSet = (resolverFn) => fields.length <= 1
                    ? `...${escapeHtml(resolverFn(fields[0]))}`
                    : fields.map(f => `<b>${escapeHtml(FIELD_LABELS[f] || f)}:</b> ${escapeHtml(resolverFn(f))}`).join('; ');

                const arr = [
                    `<li style="margin-bottom: 4px;">${formatInlineSet(f => getTruthString(f, truths, otherText))}</li>`,
                    `<li style="margin-bottom: 4px;">${formatInlineSet(f => getLieString(f, lie, otherText))}</li>`
                ].sort(() => Math.random() - 0.5);

                html += `<p>You think this might be a <b>${escapeHtml(chosenName)}</b>, but your memory is hazy. You recall two conflicting pieces of information:</p>`;
                html += `<ul>${arr.join('')}</ul>`;
            } else {
                html += `<p>You rack your brain, but fail to recall any useful information about this creature.</p>`;
            }
        } else if (p.degree === 'Critical Failure') {
            html += `<p>You are certain this is a <b>${escapeHtml(lie.fakeName)}</b>.</p>`;
            if (fields.length > 1) {
                html += `<p style="margin-bottom: 2px;"><b>Info:</b></p>${formatAutoReplyFieldsHtml(fields, f => getLieString(f, lie, otherText))}`;
            } else {
                html += `<p><b>Info:</b> ${formatAutoReplyFieldsHtml(fields, f => getLieString(f, lie, otherText))}</p>`;
            }
        } else {
            html += `<p>Result unknown.</p>`;
        }

        html += `</div></div>`;

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: game.actors.get(res.actorId) }),
            content: html,
            whisper: [game.user.id]
        });
    }
}

async function performRecallKnowledge(html, circumstanceBonus = 0) {
    const skillKey = html.find('[name="skill"]').val();
    const questionValue = html.find('[name="question"]').val() || 'all';
    const otherText = html.find('[name="otherText"]').val() || '';
    const selectedQuestion = resolveSelectedQuestion(questionValue, otherText);

    // Extract the manual bonus and combine it with any programmatic bonuses
    const manualBonus = parseInt(html.find('[name="bonusModifier"]').val()) || 0;
    const finalBonus = circumstanceBonus + manualBonus;

    const targets = Array.from(game.user.targets ?? []);
    const hasTarget = targets.length > 0;

    const dc = hasTarget ? calculateRKDC(targets[0]?.actor) : null;
    const creatureName = hasTarget ? (targets[0]?.name ?? targets[0]?.actor?.name ?? 'Unknown Creature') : null;
    const creatureAnalysis = hasTarget ? await analyzeCreature(targets[0]?.actor) : null;

    const controlled = canvas?.tokens?.controlled ?? [];
    const isPCSelected = controlled.length > 0;
    let targetActors = [];

    if (isPCSelected) {
        const seen = new Set();
        for (const token of controlled) {
            if (token.actor && !seen.has(token.actor.id)) { targetActors.push(token.actor); seen.add(token.actor.id); }
        }
    } else {
        if (!game.user.isGM && game.user.character) {
            targetActors = [game.user.character];
        } else if (game.actors.party) {
            targetActors = Array.from(game.actors.party.members);
        } else {
            targetActors = game.actors.filter(a => a.type === 'character' && (a.system?.details?.alliance === 'party' || a.alliance === 'party'));
            if (targetActors.length === 0) targetActors = game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner);
        }
    }

    if (targetActors.length === 0) {
        ui.notifications.error('No target actors found (no controlled tokens and no party actors).');
        return;
    }

    // --- Player Blind Roll if no target is selected ---
    if (!hasTarget && !game.user.isGM) {
        const actor = targetActors[0];

        const specialLores = getSpecialLores(actor);
        const specialLoreKeys = specialLores.map(sl => sl.key);

        let roll;
        try { roll = await new Roll(`1d20`).evaluate(); }
        catch (err) { ui.notifications.error("Roll error."); return; }
        const d20 = roll.dice[0].results[0].result;

        // 1. Identify and Roll the Primary Skill First
        let primaryPenalty = 0;
        let primaryLabel = null;

        const primaryLore = specialLores.find(sl => sl.key === skillKey);
        if (primaryLore) {
            primaryLabel = primaryLore.label;
            if (primaryLore.isEsoteric && primaryLore.hasDiverse) {
                primaryPenalty = -2;
                primaryLabel += " (Diverse -2)";
            }
        } else if (!SKILL_DICTIONARY[skillKey] && skillKey !== 'lore') {
            const skInfo = getSkillInfo(actor, skillKey);
            primaryLabel = skInfo ? skInfo.label : skillKey;
        }

        const primaryResult = await evaluateSkillRoll(actor, skillKey, null, primaryLabel, d20, finalBonus + primaryPenalty);

        // 2. Queue up the Secondary Skills
        const secondaryPromises = [];
        const rolledKeys = new Set([skillKey]); // Prevent duplicating the primary roll

        // Queue standard skills
        const skillKeysToRoll = Object.keys(SKILL_DICTIONARY).filter(k => k !== 'lore');
        for (const k of skillKeysToRoll) {
            if (!rolledKeys.has(k)) {
                secondaryPromises.push(evaluateSkillRoll(actor, k, null, null, d20, finalBonus));
                rolledKeys.add(k);
            }
        }

        // Queue Special Lores (Esoteric, Bardic, etc.)
        for (const sLore of specialLores) {
            if (!rolledKeys.has(sLore.key)) {
                let penalty = 0;
                let label = sLore.label;

                if (sLore.isEsoteric && sLore.hasDiverse) {
                    penalty = -2;
                    label += " (Diverse -2)";
                }
                secondaryPromises.push(evaluateSkillRoll(actor, sLore.key, null, label, d20, finalBonus + penalty));
                rolledKeys.add(sLore.key);
            }
        }

        // --- Dynamically scan for and queue all other Custom Lores ---
        const systemData = actor.system ?? actor.data?.system ?? {};
        const actorSkills = systemData.skills ?? {};
        for (const [key, skill] of Object.entries(actorSkills)) {
            if (isSkillALore(actor, key, skill) && !rolledKeys.has(key)) {
                secondaryPromises.push(evaluateSkillRoll(actor, key, null, skill.label || "Custom Lore", d20, finalBonus));
                rolledKeys.add(key);
            }
        }

        const secondaryResults = (await Promise.all(secondaryPromises)).filter(x => x);
        const pMod = primaryResult.total - d20;
        const hideBreakdown = getSetting('hideModifierBreakdown', false);

        let blindHtml = `<div style="padding:6px; font-family: 'Signika', sans-serif;">
            <h4 style="border-bottom: 2px solid #333; padding-bottom: 4px; margin-bottom: 6px;">Blind Recall Knowledge</h4>
            <p style="margin-bottom: 8px;"><strong>Actor:</strong> ${escapeHtml(actor.name)}</p>
            <p style="margin-top: 0; margin-bottom: 8px;"><strong>Base d20 Roll:</strong> <b>${d20}</b></p>
            
            <div style="border-left: 4px solid #0055aa; padding-left:8px; margin-bottom:10px; background: rgba(0,0,0,0.03); padding-top:4px; padding-bottom:4px;">
                <div style="font-size: 0.9em; color:#444; margin-bottom: 2px;">Primary Skill</div>
                <strong style="font-size: 1.1em;">${escapeHtml(primaryResult.label)}:</strong> <b style="font-size: 1.1em;">${primaryResult.total}</b> 
                <span style="font-size:0.85em; color:#555;">${hideBreakdown ? '' : `(Mod: ${pMod >= 0 ? '+' : ''}${pMod})`}</span>
            </div>

            <div style="font-size: 0.85em; color: #444; margin-bottom: 4px; padding-top: 4px; border-top: 1px dashed #ccc;"><strong>Secondary Skills:</strong></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;">`;

        for (let r of secondaryResults) {
            const mod = r.total - d20;
            blindHtml += `<div style="padding: 2px 4px; background: rgba(0,0,0,0.03); border-left: 2px solid #666; font-size: 0.9em;">
                <strong>${escapeHtml(r.label)}:</strong> <b>${r.total}</b> 
                <span style="font-size:0.85em; color:#555;">${hideBreakdown ? '' : `(${mod >= 0 ? '+' : ''}${mod})`}</span>
            </div>`;
        }

        const blindBonusText = finalBonus !== 0 ? `<p style="font-size: 0.85em; color: #aa0000; margin-top: 4px; margin-bottom: 0;"><em>(Includes ${finalBonus > 0 ? '+' : ''}${finalBonus} manual modifier)</em></p>` : '';

        blindHtml += `</div><p style="font-size: 0.85em; color: #aa5500; margin-bottom: 0;"><em>No target selected. General recall knowledge check.</em></p>${blindBonusText}</div>`;

        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: null }), content: blindHtml, whisper: gmIds, blind: true });

        await createPublicRecallMessage([{ actorName: actor.name, skillLabel: primaryResult.label }], false, selectedQuestion, game.user.isGM);
        return;
    }

    let suggestedSkillLabel = null;
    if (hasTarget) {
        const sKey = getSuggestedSkill(targets[0].actor);
        if (sKey && SKILL_DICTIONARY[sKey]) {
            suggestedSkillLabel = SKILL_DICTIONARY[sKey];
        }
    }

    const relatedMap = {
        'arcana': ['occultism', 'nature', 'lore'],
        'religion': ['occultism', 'lore'],
        'occultism': ['arcana', 'religion', 'lore'],
        'nature': ['arcana', 'lore'],
        'society': ['lore'],
        'crafting': ['nature', 'medicine', 'lore'],
        'athletics': ['acrobatics', 'lore'],
        'acrobatics': ['athletics', 'lore'],
        'stealth': ['deception', 'lore'],
        'survival': ['nature', 'lore'],
        'medicine': ['nature', 'lore'],
    };

    const rollPromises = targetActors.map(async (actor) => {
        const specialLores = getSpecialLores(actor);
        const specialLoreKeys = specialLores.map(sl => sl.key);

        // Retrieve setting to determine how to calculate Dubious Knowledge
        let hasDubiousKnowledge = false;
        const failBehavior = getSetting('failureBehavior', 'dubiousKnowledge');

        if (failBehavior === 'alwaysDubious') {
            hasDubiousKnowledge = true;
        } else if (failBehavior === 'dubiousKnowledge') {
            hasDubiousKnowledge = actor.items?.some(i => i.slug === "dubious-knowledge" || i.system?.slug === "dubious-knowledge") || false;
        } else {
            hasDubiousKnowledge = false;
        }

        let primaryPenalty = 0;
        let primaryLabel = null;

        const primaryLore = specialLores.find(sl => sl.key === skillKey);
        if (primaryLore && primaryLore.isEsoteric && primaryLore.hasDiverse && !hasTarget) {
            primaryPenalty = -2;
            primaryLabel = primaryLore.label + " (Diverse -2)";
        }

        const primaryRoll = await evaluateSkillRoll(actor, skillKey, dc, primaryLabel, null, finalBonus + primaryPenalty);
        const primaryD20 = primaryRoll.d20;

        const relatedRolls = [];
        const relatedKeys = relatedMap[skillKey] || [];

        for (const relKey of relatedKeys) {
            if (relKey === 'lore') {
                const bestLore = getBestLore(actor, specialLoreKeys);
                if (bestLore) relatedRolls.push(await evaluateSkillRoll(actor, bestLore.key, dc, bestLore.label, primaryD20, finalBonus));
            } else {
                relatedRolls.push(await evaluateSkillRoll(actor, relKey, dc, null, primaryD20, finalBonus));
            }
        }

        for (const sLore of specialLores) {
            if (sLore.key === skillKey) continue;

            let penalty = 0;
            let label = sLore.label;

            if (sLore.isEsoteric && sLore.hasDiverse && !hasTarget) {
                penalty = -2;
                label += " (Diverse -2)";
            }

            relatedRolls.push(await evaluateSkillRoll(actor, sLore.key, dc, label, primaryD20, finalBonus + penalty));
        }

        return { actorId: actor.id, actorName: actor.name, hasDubiousKnowledge: hasDubiousKnowledge, primary: primaryRoll, related: relatedRolls };
    });

    let results;
    try { results = await Promise.all(rollPromises); }
    catch (err) { ui.notifications.error('Error performing rolls.'); return; }

    await createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis, selectedQuestion, otherText, suggestedSkillLabel, finalBonus);

    if (isPCSelected || (!game.user.isGM && targetActors.length === 1)) {
        const actorRolls = results.map(res => ({ actorName: res.actorName, skillLabel: res.primary.label }));
        await createPublicRecallMessage(actorRolls, hasTarget ? true : false, selectedQuestion, game.user.isGM);
    }

    // Auto-Reply Handler
    if (getSetting('autoReply', false) && hasTarget) {
        await sendAutoReply(results, selectedQuestion, otherText, creatureAnalysis);
    }

    // Broadcast the results for other macros to catch
    Hooks.callAll('enhancedRecallKnowledgeComplete', { results: results });
}

function getSuggestedSkill(actor) {
    if (!actor || actor.type !== 'npc') return null;
    const traits = actor.system?.traits?.value || [];
    const rkMap = { aberration: 'occultism', animal: 'nature', astral: 'occultism', beast: 'nature', celestial: 'religion', construct: 'crafting', dragon: 'arcana', elemental: 'arcana', ethereal: 'occultism', fey: 'nature', fiend: 'religion', fungus: 'nature', humanoid: 'society', monitor: 'religion', ooze: 'occultism', plant: 'nature', spirit: 'occultism', undead: 'religion' };

    for (const trait of traits) {
        if (rkMap[trait]) return rkMap[trait];
    }
    return null;
}

export function openRecallKnowledgeDialog(circumstanceBonus = 0) {

    const controlled = canvas?.tokens?.controlled ?? [];
    let roller = null;
    if (controlled.length > 0) roller = controlled[0].actor;
    else if (!game.user.isGM && game.user.character) roller = game.user.character;

    const dynamicSkills = { ...SKILL_DICTIONARY };
    let specialLores = [];
    let specialKeys = [];
    const targets = Array.from(game.user.targets ?? []);

    if (roller) {
        specialLores = getSpecialLores(roller);
        specialKeys = specialLores.map(sl => sl.key);

        for (const sl of specialLores) {
            let lbl = sl.label;
            if (sl.isEsoteric && sl.hasDiverse && !targets.length) lbl += " (Diverse -2)";
            dynamicSkills[sl.key] = lbl;
        }

        // --- Inject all custom lores directly into the dropdown ---
        const systemData = roller.system ?? roller.data?.system ?? {};
        const skills = systemData.skills ?? {};
        let foundSpecificLore = false;

        for (const [key, skill] of Object.entries(skills)) {
            if (isSkillALore(roller, key, skill) && !specialKeys.includes(key)) {
                dynamicSkills[key] = skill.label || "Custom Lore";
                foundSpecificLore = true;
            }
        }

        // Remove the broken "Lore (Generic)" placeholder if real lores were successfully mapped
        if (foundSpecificLore) {
            delete dynamicSkills['lore'];
        }
    }

    let suggestedSkill = targets.length > 0 ? getSuggestedSkill(targets[0]?.actor) : null;

    // --- SMART SUGGESTION OVERRIDE --- 
    // Compares the base suggested skill modifier against the Special Lore modifiers. 
    // If a Special Lore is mathematically superior (or tied), it overrides the dropdown suggestion.
    let bestMod = -99;
    let bestSkill = suggestedSkill;

    if (suggestedSkill && roller) {
        const baseSkillInfo = getSkillInfo(roller, suggestedSkill);
        bestMod = Number(baseSkillInfo?.mod ?? baseSkillInfo?.value ?? baseSkillInfo?.totalModifier ?? baseSkillInfo?.total ?? -99);
    }

    if (roller && specialLores.length > 0) {
        for (const sl of specialLores) {
            const slInfo = getSkillInfo(roller, sl.key);
            let slMod = Number(slInfo?.mod ?? slInfo?.value ?? slInfo?.totalModifier ?? slInfo?.total ?? -99);

            if (sl.isEsoteric && sl.hasDiverse && targets.length === 0) {
                slMod -= 2;
            }

            if (slMod >= bestMod) {
                bestMod = slMod;
                bestSkill = sl.key;
            }
        }
        suggestedSkill = bestSkill;
    }

    let skillOptions = '';
    for (let [key, label] of Object.entries(dynamicSkills)) {
        const isSuggested = (key === suggestedSkill);
        skillOptions += `<option value="${escapeHtml(key)}" ${isSuggested ? 'selected' : ''}>${escapeHtml(label)}${isSuggested ? ' (Suggested)' : ''}</option>`;
    }

    const hasTarget = (targets.length > 0);
    const isGM = game.user.isGM;

    const targetWarning = hasTarget
        ? `<p style="color: green;"><em><i class="fas fa-bullseye"></i> Target detected. DC and traits will be calculated secretly.</em></p>`
        : (isGM
            ? `<p style="color: #aa5500;"><em><i class="fas fa-exclamation-triangle"></i> No target selected.</em></p>`
            : `<p style="color: #aa5500;"><em><i class="fas fa-exclamation-triangle"></i> No target selected. Will roll a generic recall knowledge check.</em></p>`);

    const buildQuestionOptionsHtml = (selectedId = null) => {
        const configuredQuestions = getConfiguredRecallQuestions();
        const opts = configuredQuestions.map(q => {
            const isSel = selectedId ? q.id === selectedId : false;
            return `<option value="${escapeHtml(q.id)}"${isSel ? ' selected' : ''}>${escapeHtml(q.label)}</option>`;
        }).join('');
        const otherSel = selectedId === RK_INFO_FIELD.OTHER ? ' selected' : '';
        return `${opts}<option value="${RK_INFO_FIELD.OTHER}"${otherSel}>Other (Specify)</option>`;
    };

    // Only prompt for a specific question if the player has an actual target
    const questionHtml = (!isGM && hasTarget) ? `
      <div class="form-group">
        <label>Question:</label>
        <select id="question-select" name="question">
            ${buildQuestionOptionsHtml()}
        </select>
      </div>
      <div class="form-group" id="other-text-group" style="display:none;">
        <label>Specify:</label>
        <input type="text" id="other-text" name="otherText" placeholder="What do you want to know?" />
      </div>
    ` : `<input type="hidden" name="question" value="all" />`;

    const content = `
    <form>
      <div class="form-group"><label>Skill to Use:</label><select id="skill-select" name="skill">${skillOptions}</select></div>
      ${questionHtml}
      
      <div class="form-group">
        <label>Bonus Modifier:</label>
        <div style="display: flex; align-items: center; width: 100%;">
            <input type="range" id="bonus-slider" name="bonusModifier" min="-10" max="10" step="1" value="0" style="flex: 1; margin-right: 8px;">
            <span id="bonus-output" style="width: 30px; text-align: right; font-weight: bold;">0</span>
        </div>
      </div>

      <hr>
      <div class="form-group" style="display:block;">
        ${targetWarning}
        <p style="font-size: 0.85em;"><em>This will roll a secret check to the GM using your currently selected token.</em></p>
      </div>
    </form>`;

    let questionsChangedHookId = null;

    new Dialog({
        title: isGM ? 'Recall Knowledge (GM Overview)' : 'Recall Knowledge Check',
        content: content,
        buttons: {
            roll: { icon: '<i class="fas fa-brain"></i>', label: 'Secret Roll', callback: (html) => performRecallKnowledge(html, circumstanceBonus) },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
        },
        default: 'roll',
        render: (html) => {
            html.find('#bonus-slider').on('input', function () {
                const val = parseInt($(this).val());
                html.find('#bonus-output').text(val > 0 ? `+${val}` : val);
            });

            if (!isGM && hasTarget) {
                const toggleOtherField = () => {
                    if (html.find('#question-select').val() === RK_INFO_FIELD.OTHER) html.find('#other-text-group').show();
                    else html.find('#other-text-group').hide();
                };

                html.find('#question-select').on('change', toggleOtherField);

                questionsChangedHookId = Hooks.on(QUESTIONS_CHANGED_HOOK, () => {
                    const prevVal = html.find('#question-select').val();
                    html.find('#question-select').html(buildQuestionOptionsHtml(prevVal));
                    toggleOtherField();
                });

                toggleOtherField();
            }
        },
        close: () => {
            if (questionsChangedHookId !== null) {
                Hooks.off(QUESTIONS_CHANGED_HOOK, questionsChangedHookId);
                questionsChangedHookId = null;
            }
        }
    }).render(true);
}