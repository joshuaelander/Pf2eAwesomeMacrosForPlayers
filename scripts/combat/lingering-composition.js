/**
 * PF2e Lingering Composition Macro (Bard Focus Spell)
 * 
 * Rules (Pathfinder Player Core / Remaster - Bard Focus 1):
 * - Cast: 1 Action (Focus Spell)
 * - Requirements: You cast a composition cantrip that has a duration of 1 round.
 * - Make a Performance check against the standard DC of the highest level target
 *   (or custom DC).
 * - Critical Success: The composition cantrip lasts 4 rounds. (1 Focus Point spent)
 * - Success: The composition cantrip lasts 3 rounds. (1 Focus Point spent)
 * - Failure: The composition cantrip lasts 1 round, but you do NOT spend the Focus Point!
 * - Critical Failure: The composition cantrip lasts 1 round, and you spend 1 Focus Point.
 * 
 * Macro Features:
 * - Selects composition cantrip (Courageous Anthem, Rallying Anthem, Song of Strength, Dirge of Doom, etc.).
 * - Automatically calculates standard DC by target / party level with custom DC override.
 * - Shows Performance check modifier, live DC preview, and focus pool status.
 * - Detects all allies (or enemies for Dirge) within 60 ft (or 30 ft) with distance indicators.
 * - Rolls the Performance check with proper PF2e check context.
 * - Handles Focus Point deduction and failure refund automatically.
 * - Places the official spell effect on the caster (with native 60 ft Aura) and/or
 *   directly applies the effect to checked allies using socketlib.
 * - Posts a detailed, stylized chat card.
 */

export const LINGERING_COMPOSITION_MACRO_NAME = "Lingering Composition";
export const LINGERING_COMPOSITION_MACRO_ICON = "icons/skills/trades/music-notes-sound-blue.webp";

/**
 * Helper to capture the next roll chat message of a specific type from an actor.
 */
function captureNextRollMessage(actorId, rollType = "skill-check", timeoutMs = 12000) {
    return new Promise((resolve) => {
        const hookId = Hooks.on("createChatMessage", (msg) => {
            if (msg.actor?.id !== actorId) return;
            const context = msg.flags?.pf2e?.context;
            if (context?.type === rollType || (rollType === "skill-check" && context?.domains?.includes("performance"))) {
                Hooks.off("createChatMessage", hookId);
                resolve(msg);
            }
        });
        setTimeout(() => {
            Hooks.off("createChatMessage", hookId);
            resolve(null);
        }, timeoutMs);
    });
}

/**
 * Standard PF2e Level-based DC Table.
 */
export function getStandardDC(level) {
    const table = {
        "-1": 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26,
        10: 27, 11: 28, 12: 30, 13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40
    };
    const numLevel = parseInt(level, 10);
    if (numLevel in table) return table[numLevel];
    if (numLevel > 20) return 40 + (numLevel - 20) * 2;
    if (numLevel < -1) return 13;
    return 14;
}

/**
 * Catalog of standard composition cantrips and their associated effect details.
 */
export const COMPOSITION_CANTRIPS = [
    {
        id: "courageous-anthem",
        name: "Courageous Anthem",
        legacyName: "Inspire Courage",
        effectSlug: "spell-effect-courageous-anthem",
        legacyEffectSlug: "spell-effect-inspire-courage",
        compendiumUuid: "Compendium.pf2e.spell-effects.Item.bePfGQgZa4TblpUp",
        icon: "icons/skills/trades/music-notes-sound-blue.webp",
        radius: 60,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "60 ft. emanation",
        targetType: "ally",
        description: "+1 status bonus to attack rolls, damage rolls, and saves vs fear.",
        rules: [
            { key: "FlatModifier", selector: "attack", value: 1, type: "status", label: "Courageous Anthem" },
            { key: "FlatModifier", selector: "damage", value: 1, type: "status", label: "Courageous Anthem" },
            { key: "FlatModifier", selector: "saving-throw", value: 1, type: "status", predicate: ["fear"], label: "Courageous Anthem (vs Fear)" }
        ]
    },
    {
        id: "rallying-anthem",
        name: "Rallying Anthem",
        legacyName: "Inspire Defense",
        effectSlug: "spell-effect-rallying-anthem",
        legacyEffectSlug: "spell-effect-inspire-defense",
        compendiumUuid: "Compendium.pf2e.spell-effects.Item.FjROWf8Aji7TaTsA",
        icon: "icons/skills/trades/music-singing-voice-blue.webp",
        radius: 60,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "60 ft. emanation",
        targetType: "ally",
        description: "+1 status bonus to AC and saves; physical resistance equal to 1.",
        rules: [
            { key: "FlatModifier", selector: "ac", value: 1, type: "status", label: "Rallying Anthem" },
            { key: "FlatModifier", selector: "saving-throw", value: 1, type: "status", label: "Rallying Anthem" },
            { key: "Resistance", type: "physical", value: 1, label: "Rallying Anthem" }
        ]
    },
    {
        id: "song-of-strength",
        name: "Song of Strength",
        legacyName: "Song of Strength",
        effectSlug: "spell-effect-song-of-strength",
        legacyEffectSlug: "spell-effect-song-of-strength",
        compendiumUuid: "Compendium.pf2e.spell-effects.Item.Fv7D906k7kGg6u9k",
        icon: "icons/skills/melee/unarmed-punch-fist.webp",
        radius: 60,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "60 ft. emanation",
        targetType: "ally",
        description: "+1 status bonus to Athletics checks and Athletics DCs.",
        rules: [
            { key: "FlatModifier", selector: "athletics", value: 1, type: "status", label: "Song of Strength" },
            { key: "FlatModifier", selector: "athletics-dc", value: 1, type: "status", label: "Song of Strength" }
        ]
    },
    {
        id: "triple-time",
        name: "Triple Time",
        legacyName: "Triple Time",
        effectSlug: "spell-effect-triple-time",
        legacyEffectSlug: "spell-effect-triple-time",
        compendiumUuid: null,
        icon: "icons/skills/movement/feet-winged-boots-glowing-yellow.webp",
        radius: 60,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "60 ft. emanation",
        targetType: "ally",
        description: "+10-foot status bonus to all Speeds.",
        rules: [
            { key: "FlatModifier", selector: "speed", value: 10, type: "status", label: "Triple Time" }
        ]
    },
    {
        id: "uplifting-overture",
        name: "Uplifting Overture",
        legacyName: "Uplifting Overture",
        effectSlug: "spell-effect-uplifting-overture",
        legacyEffectSlug: "spell-effect-uplifting-overture",
        compendiumUuid: "Compendium.pf2e.spell-effects.Item.TErgFRfydm1xmnW",
        icon: "icons/tools/instruments/harp-lap-gold.webp",
        radius: 60,
        isEmanation: false,
        singleTarget: true,
        rangeLabel: "60 ft. range (1 ally)",
        targetType: "ally",
        description: "Counts as having prepared to Aid target ally on a skill check. When using Aid, roll Performance instead of the normal skill check; a failure becomes a success, and automatically critically succeed if legendary in Performance.",
        rules: []
    },
    {
        id: "allegro",
        name: "Allegro",
        legacyName: "Allegro",
        effectSlug: "spell-effect-allegro",
        legacyEffectSlug: "spell-effect-allegro",
        compendiumUuid: null,
        icon: "icons/magic/time/hourglass-yellow-green.webp",
        radius: 30,
        isEmanation: false,
        singleTarget: true,
        rangeLabel: "30 ft. range (1 ally)",
        targetType: "ally",
        description: "Target ally is Quickened 1 (can use the extra action to Stride, Strike, or Step).",
        rules: [
            { key: "RollOption", domain: "all", option: "quickened" }
        ]
    },
    {
        id: "dirge-of-doom",
        name: "Dirge of Doom",
        legacyName: "Dirge of Doom",
        effectSlug: "spell-effect-dirge-of-doom",
        legacyEffectSlug: "spell-effect-dirge-of-doom",
        compendiumUuid: "Compendium.pf2e.spell-effects.Item.B6jQdD8z9T4P7X5G",
        icon: "icons/magic/death/skull-horned-goat-pentagram-red.webp",
        radius: 30,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "30 ft. emanation",
        targetType: "enemy",
        description: "Enemies in 30 ft emanation become Frightened 1 (cannot reduce below 1 while in range).",
        rules: [
            { key: "Aura", radius: 30, traits: ["auditory", "cantrip", "composition", "emotion", "fear", "mental"], includesSelf: false }
        ]
    },
    {
        id: "song-of-marching",
        name: "Song of Marching",
        legacyName: "Song of Marching",
        effectSlug: "spell-effect-song-of-marching",
        legacyEffectSlug: "spell-effect-song-of-marching",
        compendiumUuid: null,
        icon: "icons/tools/navigation/map-marked-blue.webp",
        radius: 60,
        isEmanation: true,
        singleTarget: false,
        rangeLabel: "60 ft. emanation",
        targetType: "ally",
        description: "Hustle for up to 1 hour without fatigue.",
        rules: []
    },
    {
        id: "house-of-imaginary-walls",
        name: "House of Imaginary Walls",
        legacyName: "House of Imaginary Walls",
        effectSlug: "spell-effect-house-of-imaginary-walls",
        legacyEffectSlug: "spell-effect-house-of-imaginary-walls",
        compendiumUuid: null,
        icon: "icons/magic/defensive/barrier-shield-dome-blue-purple.webp",
        radius: 60,
        isEmanation: false,
        singleTarget: false,
        rangeLabel: "60 ft. range",
        targetType: "ally",
        description: "Create an invisible 10-foot-by-10-foot wall.",
        rules: []
    }
];

/**
 * Returns available composition cantrips for the actor, prioritizing and dynamically
 * including any composition cantrips on the actor's character sheet.
 */
export function getAvailableCompositionCantrips(actor) {
    const list = COMPOSITION_CANTRIPS.map(c => {
        const isKnown = actor?.itemTypes?.spell?.some(s => 
            s.slug === c.id || 
            s.slug === c.effectSlug || 
            s.name.toLowerCase() === c.name.toLowerCase() ||
            (c.legacyName && s.name.toLowerCase() === c.legacyName.toLowerCase())
        ) ?? false;
        return { ...c, isKnown };
    });

    if (!actor?.itemTypes?.spell) return list;

    for (const spell of actor.itemTypes.spell) {
        const traits = spell.system?.traits?.value ?? [];
        const isComposition = traits.includes("composition") || 
            spell.name.toLowerCase().includes("anthem") || 
            spell.name.toLowerCase().includes("inspire");
        const isCantrip = spell.isCantrip || traits.includes("cantrip");

        if (!isComposition || !isCantrip) continue;

        const slug = spell.slug || spell.system?.slug || spell.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const already = list.find(c => 
            c.id === slug || 
            c.effectSlug === `spell-effect-${slug}` ||
            c.name.toLowerCase() === spell.name.toLowerCase() ||
            (c.legacyName && c.legacyName.toLowerCase() === spell.name.toLowerCase())
        );

        if (!already) {
            const rawDesc = spell.system?.description?.value?.replace(/<[^>]*>?/gm, "").trim() || "";
            const isEnemy = traits.includes("fear") || traits.includes("attack") || rawDesc.toLowerCase().includes("foe");
            let radius = 60;
            if (typeof spell.system?.area?.value === "number") {
                radius = spell.system.area.value;
            } else if (spell.system?.range?.value) {
                const parsed = parseInt(spell.system.range.value, 10);
                if (!isNaN(parsed) && parsed > 0) radius = parsed;
            }

            const targetVal = spell.system?.target?.value?.toLowerCase() || "";
            const isSingle = targetVal.includes("1 ally") || targetVal.includes("one ally") || targetVal.includes("1 target");
            const isEmanation = !isSingle && (spell.system?.area?.type === "emanation" || !spell.system?.range?.value);
            const rangeLabel = isEmanation ? `${radius} ft. emanation` : (isSingle ? `${radius} ft. range (1 ally)` : `${radius} ft. range`);

            list.push({
                id: slug,
                name: spell.name,
                legacyName: null,
                effectSlug: `spell-effect-${slug}`,
                legacyEffectSlug: null,
                compendiumUuid: spell.uuid || null,
                icon: spell.img || LINGERING_COMPOSITION_MACRO_ICON,
                radius: radius,
                isEmanation: isEmanation,
                singleTarget: isSingle,
                rangeLabel: rangeLabel,
                targetType: isEnemy ? "enemy" : "ally",
                description: rawDesc ? rawDesc.slice(0, 110) + "..." : "Composition cantrip.",
                isKnown: true,
                rules: []
            });
        }
    }

    // Sort: known cantrips first!
    list.sort((a, b) => {
        if (a.isKnown && !b.isKnown) return -1;
        if (!a.isKnown && b.isKnown) return 1;
        return a.name.localeCompare(b.name);
    });

    return list;
}

/**
 * Calculates straight line distance in feet between two tokens on the canvas.
 * Uses namespaced foundry.canvas.geometry.Ray (v13+) and canvas.grid helpers.
 */
function getDistanceBetweenTokens(token1, token2) {
    if (!token1 || !token2 || !canvas?.scene) return 0;
    try {
        const p1 = token1.center ?? token1;
        const p2 = token2.center ?? token2;

        // 1. Direct canvas.grid.measureDistance (Foundry v12+)
        if (typeof canvas.grid?.measureDistance === "function") {
            return Math.round(canvas.grid.measureDistance(p1, p2));
        }

        // 2. Direct distance from canvas.grid.measurePath
        if (typeof canvas.grid?.measurePath === "function") {
            const measured = canvas.grid.measurePath([p1, p2])?.distance;
            if (typeof measured === "number") return Math.round(measured);
        }

        // 3. Namespaced Ray in Foundry v13/v14+
        const RayClass = foundry?.canvas?.geometry?.Ray ?? globalThis.Ray;
        const ray = RayClass ? new RayClass(p1, p2) : null;
        if (ray && canvas.grid?.measureDistances) {
            return Math.round(canvas.grid.measureDistances([{ ray }], { gridSpaces: true })[0]);
        }

        const dx = (p2.x ?? p2.center?.x ?? 0) - (p1.x ?? p1.center?.x ?? 0);
        const dy = (p2.y ?? p2.center?.y ?? 0) - (p1.y ?? p1.center?.y ?? 0);
        const gridDist = canvas.scene.grid?.distance || 5;
        const gridSize = canvas.scene.grid?.size || 100;
        return Math.round((Math.hypot(dx, dy) / gridSize) * gridDist);
    } catch {
        return 0;
    }
}

/**
 * Finds all tokens on the scene matching the target type (ally or enemy) within range.
 */
function getTokensInRange(sourceToken, radiusFeet, targetType = "ally", excludeSelf = false) {
    if (!sourceToken || !canvas?.scene) return [];
    const results = [];

    for (const token of canvas.tokens.placeables) {
        if (!token?.actor) continue;
        const isSelf = token.id === sourceToken.id;
        if (excludeSelf && isSelf) continue;
        
        if (targetType === "ally") {
            const isAlly = isSelf || token.actor.hasPlayerOwner || token.document.disposition >= 1 || token.actor.type === "character";
            if (!isAlly) continue;
        } else {
            // Enemy / target of negative effect
            const isEnemy = !isSelf && (token.document.disposition <= 0 || token.actor.type === "npc");
            if (!isEnemy) continue;
        }

        const dist = isSelf ? 0 : getDistanceBetweenTokens(sourceToken, token);
        if (isSelf || dist <= radiusFeet + 2.5) {
            results.push({
                token,
                actor: token.actor,
                isSelf,
                distance: dist
            });
        }
    }

    // Sort: self first, then by distance ascending
    results.sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return a.distance - b.distance;
    });

    return results;
}

/**
 * Builds the effect data object for a composition cantrip with exact duration and aura.
 * Loads the official compendium document from pf2e.spell-effects whenever available.
 */
async function buildCompositionEffectData(cantrip, durationRounds, casterToken, casterActor) {
    let baseData = null;

    // 1. Try fetching official compendium document from pf2e.spell-effects
    const pack = game.packs.get("pf2e.spell-effects");
    if (pack) {
        try {
            const index = await pack.getIndex({ fields: ["name", "system.slug", "img"] });

            // Search by slug first
            const searchSlugs = [cantrip.effectSlug, cantrip.legacyEffectSlug].filter(Boolean);
            let match = index.find(e => searchSlugs.includes(e.system?.slug));

            // If not found by slug, search by names
            if (!match) {
                const searchNames = [
                    cantrip.name.toLowerCase(),
                    cantrip.legacyName?.toLowerCase(),
                    `spell effect: ${cantrip.name.toLowerCase()}`,
                    `spell effect: ${cantrip.legacyName?.toLowerCase()}`
                ].filter(Boolean);
                match = index.find(e => {
                    const n = e.name.toLowerCase();
                    return searchNames.some(s => n === s || n.includes(s));
                });
            }

            if (match) {
                const doc = await pack.getDocument(match._id);
                if (doc) {
                    baseData = doc.toObject();
                }
            }
        } catch (err) {
            console.warn("PF2e Lingering Composition | Could not query pf2e.spell-effects index", err);
        }
    }

    // 2. Try by compendiumUuid if pack search did not find it
    if (!baseData && cantrip.compendiumUuid) {
        try {
            const compDoc = await fromUuid(cantrip.compendiumUuid);
            if (compDoc) {
                baseData = compDoc.toObject();
            }
        } catch {
            // ignore
        }
    }

    // 3. Fallback to self-contained template if compendium unavailable
    if (!baseData) {
        baseData = {
            type: "effect",
            name: `Spell Effect: ${cantrip.name}`,
            img: cantrip.icon,
            system: {
                slug: cantrip.effectSlug,
                level: { value: 1 },
                description: { value: `<p>${cantrip.description}</p>` },
                rules: cantrip.rules || []
            }
        };
    }

    // For Dirge of Doom, ensure no harmful FlatModifier is attached to the aura effect itself
    if (cantrip.id === "dirge-of-doom" && Array.isArray(baseData.system?.rules)) {
        baseData.system.rules = baseData.system.rules.filter(r => !(r.key === "FlatModifier" && r.selector === "all"));
    }

    // Format duration and context
    baseData.system = baseData.system || {};
    baseData.system.duration = {
        value: durationRounds,
        unit: "rounds",
        expiry: "turn-start",
        sustained: false
    };

    baseData.system.context = {
        origin: {
            actor: casterActor?.uuid ?? null,
            token: casterToken?.document?.uuid ?? null
        }
    };

    return baseData;
}

/**
 * Socketlib handler to apply or update a lingering composition effect or condition as GM.
 */
export async function applyLingeringEffectAsGM(targetActorUuid, effectData, durationRounds, originActorUuid, isCondition = false, conditionSlug = null) {
    if (!targetActorUuid) return false;
    const target = await fromUuid(targetActorUuid);
    const targetActor = target?.actor ?? target;
    if (!targetActor) return false;

    // Remove any older conflicting custom dirge-of-doom effects with FlatModifier if present
    const oldCustomDirge = targetActor.itemTypes.effect.filter(e => 
        e.slug === "spell-effect-dirge-of-doom" && 
        e.system?.rules?.some(r => r.key === "FlatModifier")
    );
    if (oldCustomDirge.length > 0) {
        try {
            await targetActor.deleteEmbeddedDocuments("Item", oldCustomDirge.map(e => e.id));
        } catch (err) {
            console.warn("PF2e Lingering Composition | Could not remove obsolete dirge effect", err);
        }
    }

    // 1. If applying a native condition (such as Frightened 1 on enemies for Dirge of Doom)
    if (isCondition && conditionSlug) {
        if (typeof targetActor.increaseCondition === "function") {
            const currentVal = targetActor.getCondition?.(conditionSlug)?.value ?? 0;
            // Only increase if not already at or above 1 (prevent stacking!)
            if (currentVal < 1) {
                await targetActor.increaseCondition(conditionSlug, { value: 1 });
            }
            return true;
        }
        return false;
    }

    // 2. Regular effect application (beneficial anthems)
    if (!effectData) return false;
    const effectSlug = effectData.system?.slug;

    // Remove existing matching effect to refresh duration cleanly
    const existing = targetActor.itemTypes.effect.filter(e => 
        e.slug === effectSlug || 
        (effectSlug && e.slug?.includes(effectSlug)) ||
        e.name === effectData.name
    );
    if (existing.length > 0) {
        try {
            await targetActor.deleteEmbeddedDocuments("Item", existing.map(e => e.id));
        } catch (err) {
            console.warn("PF2e Lingering Composition | Could not remove old effect", err);
        }
    }

    // Update duration values
    effectData.system = effectData.system || {};
    effectData.system.duration = {
        value: durationRounds,
        unit: "rounds",
        expiry: "turn-start",
        sustained: false
    };

    if (originActorUuid) {
        effectData.system.context = {
            origin: {
                actor: originActorUuid
            }
        };
    }

    try {
        await targetActor.createEmbeddedDocuments("Item", [effectData]);
        return true;
    } catch (err) {
        console.error("PF2e Lingering Composition | Failed to create effect document on actor", err);
        return false;
    }
}

/**
 * Main macro execution.
 */
export async function executeLingeringComposition() {
    // 1. Get Actor and Token
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else {
        return ui.notifications.warn("Please select your Bard's token first.");
    }

    if (!actor) {
        return ui.notifications.warn("No valid actor found.");
    }

    // 2. Validate Performance Skill
    const performanceSkill = actor.skills.performance ?? actor.system.skills?.prf ?? actor.skills.prf;
    if (!performanceSkill) {
        return ui.notifications.error(`No Performance skill found on ${actor.name}.`);
    }

    const perfMod = performanceSkill.check?.mod ?? performanceSkill.totalModifier ?? performanceSkill.mod ?? 0;
    const perfModLabel = perfMod >= 0 ? `+${perfMod}` : `${perfMod}`;

    // 3. Check Focus Points and Lingering Feat
    const currentFocus = actor.system.resources?.focus?.value ?? 0;
    const maxFocus = actor.system.resources?.focus?.max ?? 0;

    const hasLingeringSpell = actor.itemTypes.spell.some(s => s.slug === "lingering-composition" || s.name.toLowerCase().includes("lingering composition"));
    const hasLingeringFeat = actor.itemTypes.feat.some(f => f.slug === "lingering-composition" || f.name.toLowerCase().includes("lingering composition"));
    const hasLingering = hasLingeringSpell || hasLingeringFeat;

    // 4. Default Target Level & DC
    const partyLevel = actor.level ?? 1;
    let defaultDC = getStandardDC(partyLevel);

    // 5. Available Cantrips (Standard + Known on Actor)
    const availableCantrips = getAvailableCompositionCantrips(actor);
    const defaultCantrip = availableCantrips[0];
    let detectedTargets = getTokensInRange(token, defaultCantrip.radius, defaultCantrip.targetType);

    // 6. Build Setup Dialog
    const focusWarningHtml = currentFocus <= 0
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(211, 47, 47, 0.1); border-left: 3px solid #d32f2f; border-radius: 3px; font-size: 0.9em; color: #b71c1c;">
             <strong>⚠️ Warning:</strong> You have <strong>0 Focus Points</strong> remaining! Lingering Composition costs 1 Focus Point (refunded on failure).
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 3px; font-size: 0.9em;">
             <strong>Focus Pool:</strong> ${currentFocus} / ${maxFocus} Focus Points available.
           </div>`;

    const featReminderHtml = !hasLingering
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.08); border-left: 3px solid #f57c00; border-radius: 3px; font-size: 0.85em; color: #b75300;">
             <em>Reminder: Lingering Composition is not listed in ${actor.name}'s spells or feats.</em>
           </div>`
        : "";

    const cantripOptionsHtml = availableCantrips.map((c, idx) => {
        const knownMark = c.isKnown ? " ★ (Known)" : "";
        const label = c.rangeLabel || (c.isEmanation !== false ? `${c.radius} ft. emanation` : `${c.radius} ft. range`);
        return `<option value="${idx}">${c.name}${knownMark} [${label}]</option>`;
    }).join("");

    const levelOptionsHtml = Array.from({ length: 26 }, (_, i) => i).map(lvl => {
        const dc = getStandardDC(lvl);
        const selected = lvl === partyLevel ? "selected" : "";
        return `<option value="${lvl}" ${selected}>Level ${lvl} (Standard DC ${dc})</option>`;
    }).join("");

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            ${focusWarningHtml}
            ${featReminderHtml}
            
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Composition Cantrip:</label>
                <select id="lc-cantrip" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${cantripOptionsHtml}
                </select>
                <div id="lc-cantrip-desc" style="margin-top: 4px; font-size: 0.85em; color: #444; font-style: italic;">
                    ${defaultCantrip.description}
                </div>
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <label style="font-weight: bold; display: block; margin-bottom: 4px;">Target / Party Level:</label>
                    <select id="lc-level" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                        ${levelOptionsHtml}
                    </select>
                </div>
                <div style="width: 110px;">
                    <label style="font-weight: bold; display: block; margin-bottom: 4px;">DC by Level:</label>
                    <input type="number" id="lc-dc" value="${defaultDC}" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa; font-weight: bold; text-align: center; background: #fafafa;"/>
                </div>
            </div>

            <div style="margin-bottom: 12px; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px; font-size: 0.9em;">
                <div style="display: flex; justify-content: space-between;">
                    <span><strong>Performance Check:</strong> ${perfModLabel}</span>
                    <span id="lc-target-dc-preview"><strong>Target DC:</strong> ${defaultDC}</span>
                </div>
                <div style="margin-top: 4px; font-size: 0.8em; color: #555;">
                    • Crit Success (DC+10): <strong>4 rounds</strong> (1 FP)<br>
                    • Success (≥ DC): <strong>3 rounds</strong> (1 FP)<br>
                    • Failure (< DC): <strong>1 round</strong> (0 FP - Refunded!)<br>
                    • Crit Failure (DC-10): <strong>1 round</strong> (1 FP)
                </div>
            </div>

            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label id="lc-targets-header" style="font-weight: bold;">Targets in Range:</label>
                    <button type="button" id="lc-toggle-all" style="font-size: 0.75em; padding: 2px 6px; cursor: pointer;">Toggle All</button>
                </div>
                <div id="lc-targets-list" style="max-height: 140px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; padding: 6px; background: #fff;">
                    <!-- Filled dynamically -->
                </div>
            </div>

            <div style="margin-bottom: 10px;">
                <label style="font-size: 0.85em; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                    <input type="checkbox" id="lc-apply-direct" checked />
                    <span>Apply effect directly to all checked targets (ensures tokens receive bonuses immediately)</span>
                </label>
            </div>
        </div>
    `;

    new Dialog({
        title: "Lingering Composition",
        content: dialogContent,
        buttons: {
            cancel: {
                label: "Cancel"
            },
            roll: {
                label: "Perform & Cast",
                callback: async (html) => {
                    const cantripIdx = parseInt(html.find("#lc-cantrip").val(), 10) || 0;
                    const selectedCantrip = availableCantrips[cantripIdx] || availableCantrips[0];
                    const chosenDC = parseInt(html.find("#lc-dc").val(), 10) || defaultDC;
                    const applyDirect = html.find("#lc-apply-direct").is(":checked");

                    // Read checked target actors
                    const checkedActorUuids = [];
                    html.find(".lc-target-checkbox:checked").each(function () {
                        checkedActorUuids.push($(this).val());
                    });

                    await executeLingeringSequence(actor, token, selectedCantrip, chosenDC, checkedActorUuids, applyDirect, currentFocus);
                }
            }
        },
        default: "roll",
        render: (html) => {
            const updateTargetList = () => {
                const cIdx = parseInt(html.find("#lc-cantrip").val(), 10) || 0;
                const c = availableCantrips[cIdx] || defaultCantrip;
                html.find("#lc-cantrip-desc").text(c.description);

                const isSingle = !!c.singleTarget;
                const headerText = isSingle
                    ? `Select 1 Ally in Range (${c.radius} ft):`
                    : (c.targetType === "enemy" ? `Foes in ${c.radius} ft. Emanation:` : `Targets in ${c.radius} ft. Emanation:`);
                html.find("#lc-targets-header").text(headerText);
                html.find("#lc-toggle-all").toggle(!isSingle);

                const targets = getTokensInRange(token, c.radius, c.targetType, isSingle);
                if (targets.length === 0) {
                    const emptyMsg = isSingle
                        ? `No allies found within ${c.radius} ft.`
                        : `No matching tokens found in ${c.radius} ft. emanation.`;
                    html.find("#lc-targets-list").html(`<div style="color: #777; font-size: 0.85em; font-style: italic;">${emptyMsg}</div>`);
                    return;
                }

                const canvasTargetIds = Array.from(game.user.targets ?? []).map(t => t.id);
                const inputType = isSingle ? "radio" : "checkbox";
                const inputName = isSingle ? "name=\"lc-target-single\"" : "";

                const listHtml = targets.map((t, idx) => {
                    const distTag = t.isSelf ? "(Self)" : `(${t.distance} ft)`;
                    const actorUuid = t.actor.uuid;
                    let isChecked = false;
                    if (isSingle) {
                        const wasCanvasTargeted = canvasTargetIds.includes(t.token.id);
                        if (wasCanvasTargeted) isChecked = true;
                        else if (idx === 0 && !targets.some(x => canvasTargetIds.includes(x.token.id))) isChecked = true;
                    } else {
                        isChecked = true;
                    }

                    return `
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 4px; font-size: 0.9em; border-bottom: 1px solid #f0f0f0;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 1;">
                                <input type="${inputType}" ${inputName} class="lc-target-checkbox" value="${actorUuid}" ${isChecked ? "checked" : ""} />
                                <span>${t.token.name} <small style="color: #666;">${distTag}</small></span>
                            </label>
                        </div>
                    `;
                }).join("");

                html.find("#lc-targets-list").html(listHtml);
            };

            const updateLevelDC = () => {
                const lvl = parseInt(html.find("#lc-level").val(), 10) || 0;
                const dc = getStandardDC(lvl);
                html.find("#lc-dc").val(dc);
                html.find("#lc-target-dc-preview").html(`<strong>Target DC:</strong> ${dc}`);
            };

            html.find("#lc-cantrip").on("change", updateTargetList);
            html.find("#lc-level").on("change", updateLevelDC);
            html.find("#lc-dc").on("input", () => {
                const val = html.find("#lc-dc").val();
                html.find("#lc-target-dc-preview").html(`<strong>Target DC:</strong> ${val}`);
            });

            html.find("#lc-toggle-all").on("click", () => {
                const boxes = html.find(".lc-target-checkbox");
                const allChecked = boxes.length > 0 && boxes.filter(":checked").length === boxes.length;
                boxes.prop("checked", !allChecked);
            });

            updateTargetList();
        }
    }).render(true);
}

/**
 * Rolls the Performance check, calculates duration, deducts/refunds focus, and applies effects.
 */
async function executeLingeringSequence(actor, token, cantrip, targetDC, targetActorUuids, applyDirect, startingFocus) {
    // 1. Roll the Performance Check
    const performanceSkill = actor.skills.performance ?? actor.system.skills?.prf ?? actor.skills.prf;
    const rollPromise = captureNextRollMessage(actor.id, "skill-check");

    await performanceSkill.roll({
        dc: { value: targetDC },
        extraRollOptions: ["action:lingering-composition", "focus-spell"]
    });

    const rollMsg = await rollPromise;

    // 2. Determine Outcome & Duration
    let outcome = rollMsg?.flags?.pf2e?.context?.outcome;
    const rollTotal = rollMsg?.rolls?.[0]?.total;

    if (!outcome && rollTotal !== undefined) {
        if (rollTotal >= targetDC + 10) outcome = "criticalSuccess";
        else if (rollTotal >= targetDC) outcome = "success";
        else if (rollTotal <= targetDC - 10) outcome = "criticalFailure";
        else outcome = "failure";
    }

    let durationRounds = 1;
    let outcomeLabel = "Success";
    let outcomeColor = "#2e7d32";
    let focusDeltaText = "1 Focus Point spent";
    let shouldDeductFocus = true;

    switch (outcome) {
        case "criticalSuccess":
            durationRounds = 4;
            outcomeLabel = "Critical Success!";
            outcomeColor = "#1b5e20";
            focusDeltaText = "1 Focus Point spent (lasts 4 rounds)";
            shouldDeductFocus = true;
            break;
        case "success":
            durationRounds = 3;
            outcomeLabel = "Success!";
            outcomeColor = "#2e7d32";
            focusDeltaText = "1 Focus Point spent (lasts 3 rounds)";
            shouldDeductFocus = true;
            break;
        case "criticalFailure":
            durationRounds = 1;
            outcomeLabel = "Critical Failure!";
            outcomeColor = "#b71c1c";
            focusDeltaText = "1 Focus Point spent (lasts 1 round)";
            shouldDeductFocus = true;
            break;
        case "failure":
        default:
            durationRounds = 1;
            outcomeLabel = "Failure";
            outcomeColor = "#c62828";
            focusDeltaText = "0 Focus Points spent (Focus Point REFUNDED!)";
            shouldDeductFocus = false;
            break;
    }

    // 3. Update Focus Points
    let remainingFocus = startingFocus;
    if (shouldDeductFocus && startingFocus > 0) {
        remainingFocus = Math.max(0, startingFocus - 1);
        try {
            await actor.update({ "system.resources.focus.value": remainingFocus });
        } catch (err) {
            console.warn("PF2e Lingering Composition | Could not deduct focus point", err);
        }
    }

    // 4. Build Effect Data from Official Compendium
    const effectData = await buildCompositionEffectData(cantrip, durationRounds, token, actor);

    // 5. Apply Effect to Caster (only for emanation cantrips)
    const casterSlug = effectData.system?.slug;
    if (cantrip.isEmanation !== false) {
        const existingCasterEffects = actor.itemTypes.effect.filter(e => 
            e.slug === casterSlug || 
            e.name === effectData.name ||
            (cantrip.id === "dirge-of-doom" && (e.slug?.includes("dirge-of-doom") || e.name?.toLowerCase().includes("dirge of doom")))
        );
        if (existingCasterEffects.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", existingCasterEffects.map(e => e.id));
        }

        // Apply the official aura effect to the caster (includesSelf: false for Dirge of Doom ensures no debuff to caster)
        await actor.createEmbeddedDocuments("Item", [effectData]);
    }

    // 6. Apply to Checked Targets (via GM Socket if other actors)
    const appliedNames = [];
    if (cantrip.isEmanation !== false && cantrip.targetType === "ally") {
        appliedNames.push(actor.name);
    }

    if (applyDirect && targetActorUuids?.length > 0) {
        for (const targetUuid of targetActorUuids) {
            if (targetUuid === actor.uuid && cantrip.isEmanation !== false) continue;
            
            let success = false;
            if (cantrip.id === "dirge-of-doom") {
                // For Dirge of Doom: apply native Frightened 1 condition to foes so it doesn't double-stack
                if (game.pf2eAwesomePlayerMacros?.applyLingeringEffect) {
                    success = await game.pf2eAwesomePlayerMacros.applyLingeringEffect(targetUuid, null, durationRounds, actor.uuid, true, "frightened");
                } else {
                    const targetDoc = await fromUuid(targetUuid);
                    const targetActor = targetDoc?.actor ?? targetDoc;
                    if (targetActor?.isOwner && typeof targetActor.increaseCondition === "function") {
                        const cur = targetActor.getCondition?.("frightened")?.value ?? 0;
                        if (cur < 1) await targetActor.increaseCondition("frightened", { value: 1 });
                        success = true;
                    }
                }
            } else {
                // For beneficial anthems & targeted cantrips: apply official spell effect document
                if (game.pf2eAwesomePlayerMacros?.applyLingeringEffect) {
                    success = await game.pf2eAwesomePlayerMacros.applyLingeringEffect(targetUuid, effectData, durationRounds, actor.uuid, false, null);
                } else {
                    const targetDoc = await fromUuid(targetUuid);
                    const targetActor = targetDoc?.actor ?? targetDoc;
                    if (targetActor?.isOwner) {
                        const oldEffects = targetActor.itemTypes.effect.filter(e => e.slug === casterSlug || e.name === effectData.name);
                        if (oldEffects.length > 0) await targetActor.deleteEmbeddedDocuments("Item", oldEffects.map(e => e.id));
                        await targetActor.createEmbeddedDocuments("Item", [effectData]);
                        success = true;
                    }
                }
            }

            if (success) {
                const doc = await fromUuid(targetUuid);
                const name = doc?.name ?? doc?.actor?.name ?? (cantrip.targetType === "enemy" ? "Foe" : "Ally");
                appliedNames.push(name);
            }
        }
    }

    // 7. Post stylized chat card with outcome & duration
    const rollTotalHtml = rollTotal !== undefined ? `<strong>Check Result:</strong> ${rollTotal} vs DC ${targetDC}` : `<strong>Target DC:</strong> ${targetDC}`;
    const roundPlural = durationRounds === 1 ? "round" : "rounds";

    const targetSectionTitle = cantrip.targetType === "enemy" 
        ? `Foes Affected (Frightened 1):` 
        : (cantrip.singleTarget 
            ? `Target Ally (${durationRounds} ${roundPlural}):`
            : `Affected Recipients (${durationRounds} ${roundPlural}):`);

    const targetBadgesHtml = appliedNames.length > 0
        ? appliedNames.map(n => `<span style="display: inline-block; margin: 2px 4px 2px 0; padding: 2px 6px; background: rgba(0,0,0,0.06); border-radius: 3px; font-size: 0.85em;">✓ ${n}</span>`).join("")
        : (cantrip.isEmanation !== false
            ? `<em style="color: #666; font-size: 0.85em;">No external targets affected. (${cantrip.rangeLabel || `${cantrip.radius} ft.`} Aura active on ${actor.name})</em>`
            : `<em style="color: #666; font-size: 0.85em;">No target selected.</em>`);

    const auraDescription = cantrip.isEmanation !== false
        ? (cantrip.targetType === "enemy"
            ? `<strong>Active Aura:</strong> ${cantrip.name} (${cantrip.radius} ft. emanation, lasts ${durationRounds} ${roundPlural})`
            : `<strong>Active Aura (${cantrip.name}):</strong> ${cantrip.description}`)
        : `<strong>Targeted Effect (${cantrip.name}):</strong> ${cantrip.description}`;

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${LINGERING_COMPOSITION_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Lingering Composition</h3>
                </header>
                <div class="card-content">
                    <p style="margin-bottom: 6px;">
                        <strong>${actor.name}</strong> plays a lingering melody alongside <strong>${cantrip.name}</strong>!
                    </p>
                    <div style="margin-bottom: 8px; padding: 6px 10px; background: rgba(0,0,0,0.03); border-left: 3px solid ${outcomeColor}; border-radius: 3px;">
                        <div style="font-size: 1.05em; font-weight: bold; color: ${outcomeColor};">${outcomeLabel}</div>
                        <div style="font-size: 0.85em; color: #444; margin-top: 2px;">
                            ${rollTotalHtml}<br>
                            <strong>Duration:</strong> ${durationRounds} ${roundPlural}<br>
                            <strong>Focus:</strong> ${focusDeltaText}
                        </div>
                    </div>
                    <div style="margin-bottom: 6px; font-size: 0.85em; color: #333;">
                        ${auraDescription}
                    </div>
                    <div style="margin-top: 4px;">
                        <div style="font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.5px; color: #555; font-weight: bold; margin-bottom: 2px;">${targetSectionTitle}</div>
                        <div>${targetBadgesHtml}</div>
                    </div>
                </div>
            </div>
        `
    });
}

