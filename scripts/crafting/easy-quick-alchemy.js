/**
 * PF2e Easy Quick Alchemy Macro (Alchemist - Remaster / Player Core 2)
 *
 * Features:
 * - Detects active Alchemist / Quick Alchemy character and current Versatile Vial stock.
 * - Detects Research Field features on the character sheet (Bomber, Chirurgeon, Mutagenist, Toxicologist).
 * - Indexes known alchemical formulas in the character's formula book up to their current level.
 * - Organizes craftable items into clear filter tabs: All, Bombs, Elixirs, Mutagens, Poisons, Other,
 *   along with instant text search, persistent level/name sorting, and MAP selection for bomb strikes.
 * - Formula Creation ("Create Consumable"):
 *     - Requires at least 1 Versatile Vial in inventory (blocks formula items when at 0 vials).
 *     - Deducts 1 Versatile Vial from inventory (preserving the item at 0 quantity rather than deleting it).
 *     - For Bombs: Temporarily creates the held infused bomb and opens Foundry's Strike roll dialog
 *       against the selected target (cancelling the attack dialog refunds the vial and removes the temp bomb).
 *     - For Elixirs, Mutagens, Poisons, and Other Consumables: Creates the infused item, posts its full
 *       item description card (`toMessage()`) so effects can be dragged, triggers `consume()`, and cleans up.
 * - Quick Vial ("Quick Vial" - 0 Versatile Vials Spent):
 *     - Remains available even when 0 Versatile Vials remain in inventory.
 *     - Bombs Tab: Throws a Quick Vial bomb Strike (supports Bomber elemental damage type selection).
 *     - Field Vials (Chirurgeon, Mutagenist, Toxicologist): Gated by the matching Research Field feat.
 * - Auto-cleans up temporary Quick Alchemy / Quick Vial bomb items after damage rolls, turn changes,
 *   combat end, out-of-combat timeouts, and macro reopen.
 */

import { ROLL_TYPE } from "../constants.js";

export const EASY_QUICK_ALCHEMY_MACRO_NAME = "Easy Quick Alchemy";
export const EASY_QUICK_ALCHEMY_MACRO_ICON = "systems/pf2e/icons/features/classes/alchemical-mastery.webp";

const MODULE_ID = "pf2e-awesome-macros-for-players";
const SETTING_KEYS = Object.freeze({
    SORT_ORDER: "quickAlchemySortOrder",
    HIGHEST_LEVEL_ONLY: "quickAlchemyHighestLevelOnly"
});

const TIER_REGEX = Object.freeze({
    PAREN: /\s*\((minor|lesser|moderate|greater|major|true|superior|standard|standard-grade|low-grade|high-grade|type\s+[0-9a-z]+)\)\s*$/i,
    PREFIX: /^(minor|lesser|moderate|greater|major|true|superior|standard)\s+/i,
    SLUG: /-(minor|lesser|moderate|greater|major|true|superior|standard|standard-grade|low-grade|high-grade|type-[0-9a-z]+)$/i
});

const VERSATILE_VIAL = Object.freeze({
    NAME: "Versatile Vial",
    TEMP_NAME: "Quick Vial",
    SLUG: "versatile-vial",
    PACK_ID: "pf2e.equipment-srd",
    ITEM_ID: "ljT5pe8D7rudJqus",
    UUID: "Compendium.pf2e.equipment-srd.Item.ljT5pe8D7rudJqus",
    DEFAULT_DAMAGE_TYPE: "acid",
    ZERO_VIAL_BADGE: "Uses 0 Vials (Quick Vial)"
});

const RESEARCH_FIELD = Object.freeze({
    BOMBER: "bomber",
    CHIRURGEON: "chirurgeon",
    MUTAGENIST: "mutagenist",
    TOXICOLOGIST: "toxicologist"
});

const RESEARCH_FIELD_LABELS = Object.freeze({
    [RESEARCH_FIELD.BOMBER]: "Bomber",
    [RESEARCH_FIELD.CHIRURGEON]: "Chirurgeon",
    [RESEARCH_FIELD.MUTAGENIST]: "Mutagenist",
    [RESEARCH_FIELD.TOXICOLOGIST]: "Toxicologist"
});

const ALCHEMICAL_CATEGORY = Object.freeze({
    ALL: "all",
    BOMB: "bomb",
    ELIXIR: "elixir",
    MUTAGEN: "mutagen",
    POISON: "poison",
    OTHER: "other"
});

const CATEGORY_CONFIG = Object.freeze({
    [ALCHEMICAL_CATEGORY.ALL]: { tabLabel: "All", badgeLabel: "All" },
    [ALCHEMICAL_CATEGORY.BOMB]: { tabLabel: "Bombs", badgeLabel: "Bomb" },
    [ALCHEMICAL_CATEGORY.ELIXIR]: { tabLabel: "Elixirs", badgeLabel: "Elixir" },
    [ALCHEMICAL_CATEGORY.MUTAGEN]: { tabLabel: "Mutagens", badgeLabel: "Mutagen" },
    [ALCHEMICAL_CATEGORY.POISON]: { tabLabel: "Poisons", badgeLabel: "Poison" },
    [ALCHEMICAL_CATEGORY.OTHER]: { tabLabel: "Other", badgeLabel: "Alchemical" }
});

const SORT_ORDER = Object.freeze({
    NAME: "name",
    LEVEL_DESC: "level-desc",
    LEVEL_ASC: "level-asc"
});

const SORT_OPTIONS = Object.freeze([
    { value: SORT_ORDER.NAME, label: "Name (A-Z)" },
    { value: SORT_ORDER.LEVEL_DESC, label: "Level (High - Low)" },
    { value: SORT_ORDER.LEVEL_ASC, label: "Level (Low - High)" }
]);

const BOMBER_DAMAGE_TYPES = Object.freeze([
    { value: "acid", label: "Acid" },
    { value: "cold", label: "Cold" },
    { value: "electricity", label: "Electricity" },
    { value: "fire", label: "Fire" }
]);
const BOMBER_DAMAGE_VALUES = new Set(BOMBER_DAMAGE_TYPES.map(d => d.value));

const MAP_OPTIONS = Object.freeze([
    { value: "0", label: "No MAP" },
    { value: "1", label: "MAP -5 (-4 Agile)" },
    { value: "2", label: "MAP -10 (-8 Agile)" }
]);

const QUICK_VIAL_ACTION = Object.freeze({
    BOMB: "quick-vial-bomb"
});

const FIELD_VIAL_SPECS = Object.freeze({
    [RESEARCH_FIELD.CHIRURGEON]: Object.freeze({
        field: RESEARCH_FIELD.CHIRURGEON,
        label: RESEARCH_FIELD_LABELS[RESEARCH_FIELD.CHIRURGEON],
        actionId: `quick-vial-${RESEARCH_FIELD.CHIRURGEON}`,
        category: ALCHEMICAL_CATEGORY.ELIXIR,
        title: "Quick Vial: Chirurgeon Field Vial",
        actionLabel: "Heal",
        traits: ["Alchemical", "Coagulant", "Elixir", "Healing", "Infused"],
        subtitle: (vialDice) => `Heals a living creature for ${vialDice}d6 HP (drink or throw 20 ft.).`
    }),
    [RESEARCH_FIELD.MUTAGENIST]: Object.freeze({
        field: RESEARCH_FIELD.MUTAGENIST,
        label: RESEARCH_FIELD_LABELS[RESEARCH_FIELD.MUTAGENIST],
        actionId: `quick-vial-${RESEARCH_FIELD.MUTAGENIST}`,
        category: ALCHEMICAL_CATEGORY.MUTAGEN,
        title: "Quick Vial: Mutagenist Field Vial",
        actionLabel: "Drink",
        traits: ["Alchemical", "Elixir", "Infused"],
        subtitle: () => "Suppresses the drawback of one active mutagen for 1 minute."
    }),
    [RESEARCH_FIELD.TOXICOLOGIST]: Object.freeze({
        field: RESEARCH_FIELD.TOXICOLOGIST,
        label: RESEARCH_FIELD_LABELS[RESEARCH_FIELD.TOXICOLOGIST],
        actionId: `quick-vial-${RESEARCH_FIELD.TOXICOLOGIST}`,
        category: ALCHEMICAL_CATEGORY.POISON,
        title: "Quick Vial: Toxicologist Field Vial",
        actionLabel: "Apply",
        traits: ["Alchemical", "Infused", "Injury", "Poison"],
        subtitle: (vialDice) => `Applies ${vialDice}d6 poison damage to a weapon/ammo until end of turn.`
    })
});

const TIMING = Object.freeze({
    STALE_TEMP_ITEM_MS: 15000,
    POST_DAMAGE_CLEANUP_MS: 300,
    OUT_OF_COMBAT_CLEANUP_MS: 45000
});

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return "";
    return String(unsafe)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function deepClone(obj) {
    if (!obj) return {};
    if (globalThis.foundry?.utils?.deepClone) {
        return foundry.utils.deepClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
}

function reassertTarget(targetToken) {
    if (!targetToken) return;
    try {
        const tokenObj = targetToken.object ?? targetToken;
        if (typeof tokenObj.setTarget === "function") {
            tokenObj.setTarget(true, { user: game.user, releaseOthers: false });
        }
    } catch (err) {
        console.warn("PF2e Easy Quick Alchemy | Could not reassert target", err);
    }
}

function resolveCurrentTarget(currentTarget) {
    if (currentTarget) return currentTarget;
    return game.user.targets?.size > 0 ? Array.from(game.user.targets)[0] : null;
}

function getTraitsArray(entry) {
    if (Array.isArray(entry?.system?.traits?.value)) return entry.system.traits.value;
    if (Array.isArray(entry?.traits?.value)) return entry.traits.value;
    return [];
}

function createChatCardHtml({ img = EASY_QUICK_ALCHEMY_MACRO_ICON, title, traits = [], bodyHtml }) {
    const traitsHtml = traits.length > 0
        ? `<div style="margin-bottom: 4px; font-size: 0.8em; color: #555;">
               <strong>Traits:</strong> ${escapeHtml(traits.join(", "))}
           </div>`
        : "";

    return `
        <div class="pf2e chat-card">
            <header class="card-header flexrow">
                <img src="${escapeHtml(img)}" width="36" height="36" style="border:none; margin-right:6px;"/>
                <h3>${escapeHtml(title)}</h3>
            </header>
            <div class="card-content">
                ${traitsHtml}
                ${bodyHtml}
            </div>
        </div>
    `;
}

/**
 * Returns the Versatile Vial damage dice count (1d6 to 4d6) based on actor level.
 */
function getVersatileVialDiceCount(level) {
    if (level >= 18) return 4;
    if (level >= 12) return 3;
    if (level >= 4) return 2;
    return 1;
}

/**
 * Detects the character's Alchemist research field feats / features.
 */
function getResearchFields(actor) {
    const feats = actor?.itemTypes?.feat ?? [];
    const rollOptions = actor?.flags?.pf2e?.rollOptions?.all ?? actor?.rollOptions?.all ?? {};

    const hasFieldFeature = (fieldSlug) => {
        if (rollOptions[`feature:${fieldSlug}`] || rollOptions[`self:feature:${fieldSlug}`]) return true;
        return feats.some(f => {
            const slug = (f.slug || f.system?.slug || "").toLowerCase();
            const name = (f.name || "").toLowerCase();
            return slug === fieldSlug ||
                slug === `field-vials-${fieldSlug}` ||
                name === fieldSlug ||
                name.includes(`(${fieldSlug})`);
        });
    };

    const result = {};
    for (const fieldKey of Object.values(RESEARCH_FIELD)) {
        result[fieldKey] = hasFieldFeature(fieldKey);
    }
    return result;
}

/**
 * Reads the actor's Versatile Vial inventory item and/or SpecialResource count,
 * ignoring temporary Quick Alchemy items created by this macro.
 */
function getVersatileVialState(actor) {
    const vialItem = actor.items.find(i => {
        if (i.flags?.[MODULE_ID]?.quickAlchemyTemp) return false;
        const slug = (i.slug || i.system?.slug || "").toLowerCase();
        const sourceId = i.sourceId || i._stats?.compendiumSource || i.flags?.core?.sourceId || "";
        const nameLower = (i.name || "").toLowerCase();
        return slug === VERSATILE_VIAL.SLUG ||
            sourceId === VERSATILE_VIAL.UUID ||
            (nameLower === VERSATILE_VIAL.NAME.toLowerCase() && (i.type === "weapon" || i.type === "consumable"));
    }) ?? null;

    const resource = actor.system?.resources?.versatileVials ?? null;
    const itemQty = vialItem ? Number(vialItem.system?.quantity ?? 0) : null;
    const resVal = resource ? Number(resource.value ?? 0) : null;

    return {
        vialItem,
        resource,
        count: itemQty !== null ? itemQty : (resVal ?? 0),
        max: resource?.max ?? null
    };
}

/**
 * Decrements the actor's stocked Versatile Vial count by 1 (preserving the item at quantity 0).
 */
async function consumeOneVersatileVial(actor) {
    const state = getVersatileVialState(actor);
    if (state.count < 1) return false;

    if (state.vialItem) {
        const newQty = Math.max(0, Number(state.vialItem.system?.quantity ?? 0) - 1);
        await state.vialItem.update({ "system.quantity": newQty });
        return true;
    }

    if (state.resource) {
        const newVal = Math.max(0, Number(state.resource.value ?? 0) - 1);
        await actor.update({ "system.resources.versatileVials.value": newVal });
        return true;
    }

    return false;
}

/**
 * Deletes an array of embedded item IDs if they still exist on the actor.
 */
async function deleteActorItemsById(actor, itemIds, warnContext = "Cleanup warning") {
    if (!actor?.isOwner || !itemIds?.length) return;
    const remainingIds = itemIds.filter(id => actor.items.get(id));
    if (remainingIds.length === 0) return;

    try {
        await actor.deleteEmbeddedDocuments("Item", remainingIds);
    } catch (err) {
        console.warn(`PF2e Easy Quick Alchemy | ${warnContext}:`, err);
    }
}

/**
 * Removes stale or already-depleted (quantity <= 0) temporary Quick Alchemy items from an actor.
 */
async function cleanupTempQuickAlchemyItems(actor, maxAgeMs = TIMING.STALE_TEMP_ITEM_MS) {
    if (!actor?.isOwner) return;
    const now = Date.now();
    const staleIds = actor.items
        .filter(i => {
            const flag = i.flags?.[MODULE_ID];
            if (!flag?.quickAlchemyTemp) return false;
            if (Number(i.system?.quantity ?? 1) <= 0) return true;
            return !maxAgeMs || (now - (flag.createdAt || 0) >= maxAgeMs);
        })
        .map(i => i.id);

    await deleteActorItemsById(actor, staleIds, "Failed to clean up temporary items");
}

/**
 * Registers global hooks once per session to clean up temporary infused bomb items
 * when damage is rolled, when turns advance past their expiration, or when combat ends.
 */
function ensureTempItemCleanupHooks() {
    if (globalThis.__pf2eAwesomeQuickAlchemyCleanupHook) return;
    globalThis.__pf2eAwesomeQuickAlchemyCleanupHook = true;

    Hooks.on("createChatMessage", (msg) => {
        if (msg?.flags?.pf2e?.context?.type !== ROLL_TYPE.DAMAGE) return;
        const actor = msg.actor;
        if (!actor?.isOwner) return;

        const originUuid = msg.flags?.pf2e?.origin?.uuid || "";
        const itemId = msg.item?.id || originUuid.split(".Item.")[1];
        const deleteIds = actor.items
            .filter(i => {
                if (!i.flags?.[MODULE_ID]?.quickAlchemyTemp) return false;
                if (itemId && i.id === itemId) return true;
                return Number(i.system?.quantity ?? 1) <= 0;
            })
            .map(i => i.id);

        if (deleteIds.length > 0) {
            setTimeout(() => {
                deleteActorItemsById(actor, deleteIds, "Post-damage cleanup warning");
            }, TIMING.POST_DAMAGE_CLEANUP_MS);
        }
    });

    Hooks.on("combatTurnChange", async (combat) => {
        if (!combat?.combatants) return;
        const currentRound = combat.round ?? 0;
        const currentTurn = combat.turn ?? 0;
        const activeCombatant = combat.combatant;

        for (const combatant of combat.combatants) {
            const actor = combatant.actor;
            if (!actor?.isOwner) continue;

            const expiredIds = [];
            for (const item of actor.items) {
                const flag = item.flags?.[MODULE_ID];
                if (!flag?.quickAlchemyTemp) continue;

                if (Number(item.system?.quantity ?? 1) <= 0) {
                    expiredIds.push(item.id);
                    continue;
                }

                // Quick Vials expire once the actor's turn ends; other temp items expire on next turn / later rounds
                if (flag.combatId === combat.id) {
                    const turnLeftActor = Boolean(flag.quickVial) && activeCombatant?.actorId !== actor.id;
                    const isActorsNewTurn = activeCombatant?.actorId === actor.id &&
                        (currentRound > (flag.createdRound ?? 0) || currentTurn !== (flag.createdTurn ?? -1));
                    const isMuchLaterRound = currentRound > (flag.createdRound ?? 0) + 1;
                    if (turnLeftActor || isActorsNewTurn || isMuchLaterRound) {
                        expiredIds.push(item.id);
                    }
                }
            }

            await deleteActorItemsById(actor, expiredIds, "Turn cleanup warning");
        }
    });

    Hooks.on("deleteCombat", async (combat) => {
        for (const combatant of combat.combatants ?? []) {
            if (combatant.actor?.isOwner) {
                await cleanupTempQuickAlchemyItems(combatant.actor, 0);
            }
        }
    });
}

/**
 * Categorizes an alchemical item into bomb, mutagen, elixir, poison, or other.
 * Note: Mutagens also carry the 'elixir' trait in PF2e, so mutagens MUST be checked first.
 */
function classifyAlchemicalCategory(entry) {
    const traits = getTraitsArray(entry);
    const nameLower = (entry.name || "").toLowerCase();
    const category = (entry.system?.category || "").toLowerCase();
    const consumableType = (entry.system?.consumableType?.value || "").toLowerCase();

    if (traits.includes(ALCHEMICAL_CATEGORY.BOMB) || category === ALCHEMICAL_CATEGORY.BOMB || consumableType === ALCHEMICAL_CATEGORY.BOMB) {
        return ALCHEMICAL_CATEGORY.BOMB;
    }
    if (traits.includes(ALCHEMICAL_CATEGORY.MUTAGEN) || nameLower.includes(ALCHEMICAL_CATEGORY.MUTAGEN)) {
        return ALCHEMICAL_CATEGORY.MUTAGEN;
    }
    if (traits.includes(ALCHEMICAL_CATEGORY.ELIXIR) || nameLower.includes(ALCHEMICAL_CATEGORY.ELIXIR)) {
        return ALCHEMICAL_CATEGORY.ELIXIR;
    }
    if (traits.includes(ALCHEMICAL_CATEGORY.POISON) || category === ALCHEMICAL_CATEGORY.POISON || consumableType === ALCHEMICAL_CATEGORY.POISON) {
        return ALCHEMICAL_CATEGORY.POISON;
    }
    return ALCHEMICAL_CATEGORY.OTHER;
}

/**
 * Prepares temporary item data cloned from a document/compendium entry.
 */
function buildInfusedTempItemData(sourceObj, { isQuickVial = false, damageType = null } = {}) {
    const data = deepClone(sourceObj);

    delete data._id;
    if (data._stats) delete data._stats.compendiumSource;
    if (data.flags?.core) delete data.flags.core.sourceId;
    if (data.flags?.pf2e) delete data.flags.pf2e.sourceId;

    data.system = data.system || {};
    data.system.quantity = 1;
    data.system.traits = data.system.traits || {};

    let traits = Array.isArray(data.system.traits.value) ? [...data.system.traits.value] : [];
    if (!traits.includes("infused")) traits.push("infused");

    if (isQuickVial) {
        data.name = VERSATILE_VIAL.TEMP_NAME;
        if (damageType && BOMBER_DAMAGE_VALUES.has(damageType)) {
            traits = traits.filter(t => !BOMBER_DAMAGE_VALUES.has(t));
            traits.push(damageType);
            if (data.system.damage) {
                data.system.damage.damageType = damageType;
            }
        }
    }
    data.system.traits.value = traits;

    if (data.system.uses) {
        data.system.uses.value = data.system.uses.max || 1;
        data.system.uses.autoDestroy = true;
    }

    const activeCombat = game.combat;
    data.flags = data.flags || {};
    data.flags[MODULE_ID] = {
        quickAlchemyTemp: true,
        quickVial: isQuickVial,
        createdAt: Date.now(),
        combatId: activeCombat?.id ?? null,
        createdRound: activeCombat?.round ?? null,
        createdTurn: activeCombat?.turn ?? null
    };

    return data;
}

/**
 * Executes a Bomb Strike via Quick Alchemy (either a known Bomb formula or a Quick Vial bomb).
 */
async function executeBombQuickAlchemy(actor, target, itemData, mapIndex, isQuickVial) {
    if (!isQuickVial && getVersatileVialState(actor).count < 1) {
        return ui.notifications.warn("No Versatile Vials remaining! Only Quick Vial can be created.");
    }

    // Ensure the temporary bomb is immediately held in 1 hand so PF2e compiles it as a ready Strike
    itemData.system.equipped = {
        ...(itemData.system.equipped || {}),
        carryType: "held",
        handsHeld: 1
    };

    const createdDocs = await actor.createEmbeddedDocuments("Item", [itemData]);
    const createdBomb = createdDocs?.[0];
    if (!createdBomb) {
        return ui.notifications.error("Failed to create temporary bomb item for Strike.");
    }

    const findStrike = () => actor.system?.actions?.find(a => a.type === "strike" && a.item?.id === createdBomb.id);
    let strike = findStrike();
    if (!strike && typeof actor.prepareData === "function") {
        actor.prepareData();
        strike = findStrike();
    }

    if (!strike || !strike.variants?.length) {
        await deleteActorItemsById(actor, [createdBomb.id]);
        return ui.notifications.error(`Could not compile Strike action for ${createdBomb.name}.`);
    }

    const variantIdx = Math.min(Math.max(0, mapIndex), strike.variants.length - 1);
    reassertTarget(target);

    const rollResult = await strike.variants[variantIdx].roll({
        skipDialog: false,
        target: target?.object ?? target
    }) ?? null;

    if (!rollResult) {
        await deleteActorItemsById(actor, [createdBomb.id]);
        ui.notifications.info(`${createdBomb.name} attack cancelled — Versatile Vial was not spent.`);
        return;
    }

    if (!isQuickVial) {
        await consumeOneVersatileVial(actor);
        const remaining = getVersatileVialState(actor).count;
        ui.notifications.info(`Crafted & threw ${createdBomb.name} (1 Versatile Vial spent; ${remaining} remaining).`);
    } else {
        ui.notifications.info(`${VERSATILE_VIAL.TEMP_NAME} created & thrown (0 Versatile Vials spent).`);
    }

    // Out-of-combat safety cleanup in case attack misses and no damage roll is ever clicked
    if (!game.combat) {
        setTimeout(() => {
            deleteActorItemsById(actor, [createdBomb.id], "Out-of-combat cleanup warning");
        }, TIMING.OUT_OF_COMBAT_CLEANUP_MS);
    }
}

/**
 * Executes a non-bomb formula consumable (Elixir, Mutagen, Poison, Other):
 * spends 1 Versatile Vial, creates the infused item, posts its description card (`toMessage()`),
 * triggers consumption, and ensures no temp item lingers in inventory.
 */
async function executeConsumableQuickAlchemy(actor, token, formulaItem) {
    if (getVersatileVialState(actor).count < 1) {
        return ui.notifications.warn("No Versatile Vials remaining! Only Quick Vial can be created.");
    }

    const sourceDoc = await fromUuid(formulaItem.uuid);
    if (!sourceDoc) {
        return ui.notifications.error(`Could not load formula document for ${formulaItem.name}.`);
    }

    const tempData = buildInfusedTempItemData(sourceDoc.toObject(), { isQuickVial: false });
    const spent = await consumeOneVersatileVial(actor);
    if (!spent) {
        return ui.notifications.warn("Failed to spend a Versatile Vial.");
    }

    const createdDocs = await actor.createEmbeddedDocuments("Item", [tempData]);
    const createdItem = createdDocs?.[0];
    if (!createdItem) {
        return ui.notifications.error(`Failed to create ${formulaItem.name}.`);
    }

    try {
        const hasToMessage = typeof createdItem.toMessage === "function";
        const hasConsume = typeof createdItem.consume === "function";

        // Post full item description card first so players can drag @UUID effect links before consuming
        if (hasToMessage) {
            await createdItem.toMessage();
        }
        if (hasConsume) {
            await createdItem.consume();
        } else if (!hasToMessage) {
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor, token }),
                content: createChatCardHtml({
                    img: formulaItem.img,
                    title: formulaItem.name,
                    bodyHtml: `<p><strong>${escapeHtml(actor.name)}</strong> creates and uses @UUID[${formulaItem.uuid}]{${escapeHtml(formulaItem.name)}} via Quick Alchemy.</p>`
                })
            });
        }
    } finally {
        await deleteActorItemsById(actor, [createdItem.id], "Consumable cleanup warning");
    }

    const remaining = getVersatileVialState(actor).count;
    ui.notifications.info(`Used ${formulaItem.name} via Quick Alchemy (1 Versatile Vial spent; ${remaining} remaining).`);
}

/**
 * Posts the Chirurgeon healing card via DamageRoll if available, falling back to an inline @Damage chat card.
 */
async function rollChirurgeonFieldVial(actor, token, target, spec, diceCount, cardImg) {
    const targetTokenDoc = target?.document ?? target;
    const targetActorDoc = target?.actor ?? null;
    const targetData = targetTokenDoc?.uuid ? {
        token: targetTokenDoc.uuid,
        actor: targetActorDoc?.uuid ?? targetTokenDoc.actorId ?? null
    } : null;

    const flavorHtml = createChatCardHtml({
        img: cardImg,
        title: spec.title,
        traits: spec.traits,
        bodyHtml: `
            <p style="margin: 4px 0; font-size: 0.9em;">
                <strong>${escapeHtml(actor.name)}</strong> creates a ${VERSATILE_VIAL.TEMP_NAME} to heal a living creature (drink or throw up to 20 ft. as an Interact action).
            </p>
        `
    });

    try {
        const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
        if (DamageRoll) {
            const healRoll = new DamageRoll(`${diceCount}d6[healing]`);
            await healRoll.evaluate();
            await healRoll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor, token }),
                flavor: flavorHtml,
                flags: targetData ? { pf2e: { target: targetData, context: { target: targetData } } } : {}
            });
            ui.notifications.info(`${spec.label} Field Vial healing rolled (${diceCount}d6; 0 Versatile Vials spent).`);
            return;
        }
    } catch (err) {
        console.warn("PF2e Easy Quick Alchemy | DamageRoll healing fallback:", err);
    }

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `${flavorHtml}<p>@Damage[${diceCount}d6[healing]]</p>`
    });
}

/**
 * Builds body markup for the Mutagenist Field Vial chat card, listing active mutagen effects.
 */
function buildMutagenistCardBody(actor) {
    const mutagenKey = ALCHEMICAL_CATEGORY.MUTAGEN;
    const activeMutagens = actor.itemTypes?.effect?.filter(e => {
        const slug = (e.slug || e.system?.slug || "").toLowerCase();
        const name = (e.name || "").toLowerCase();
        const traits = getTraitsArray(e);
        return slug.includes(mutagenKey) || name.includes(mutagenKey) || traits.includes(mutagenKey);
    }) ?? [];

    const activeMutagensHtml = activeMutagens.length > 0
        ? `<div style="margin-top: 6px; padding: 4px 8px; background: rgba(0,0,0,0.04); border-left: 3px solid #6a1b9a; font-size: 0.85em;">
               <strong>Active Mutagens:</strong> ${activeMutagens.map(m => escapeHtml(m.name)).join(", ")}
           </div>`
        : `<div style="margin-top: 6px; font-size: 0.85em; color: #666; font-style: italic;">No active mutagen effects currently detected on ${escapeHtml(actor.name)}.</div>`;

    return `
        <p style="margin: 4px 0; font-size: 0.9em;">
            <strong>${escapeHtml(actor.name)}</strong> drinks a ${VERSATILE_VIAL.TEMP_NAME} to suppress the drawback from one mutagen currently affecting them for <strong>1 minute</strong>.
        </p>
        ${activeMutagensHtml}
    `;
}

/**
 * Executes a Research Field Quick Vial action (0 Versatile Vial cost).
 */
async function executeFieldVialAction(actor, token, target, fieldKey, actorLevel, cardImg) {
    const spec = FIELD_VIAL_SPECS[fieldKey];
    if (!spec) return;

    const diceCount = getVersatileVialDiceCount(actorLevel);
    if (fieldKey === RESEARCH_FIELD.CHIRURGEON) {
        await rollChirurgeonFieldVial(actor, token, target, spec, diceCount, cardImg);
        return;
    }

    const bodyHtml = fieldKey === RESEARCH_FIELD.MUTAGENIST
        ? buildMutagenistCardBody(actor)
        : `<p style="margin: 4px 0; font-size: 0.9em;">
               <strong>${escapeHtml(actor.name)}</strong> applies a ${VERSATILE_VIAL.TEMP_NAME} to a weapon or piece of ammunition as an injury poison. It adds @Damage[${diceCount}d6[poison]] damage to the first successful Strike before becoming inert at the end of this turn.
           </p>`;

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: createChatCardHtml({
            img: cardImg,
            title: spec.title,
            traits: spec.traits,
            bodyHtml
        })
    });

    const detail = fieldKey === RESEARCH_FIELD.TOXICOLOGIST ? `${diceCount}d6 poison; ` : "";
    ui.notifications.info(`Used ${spec.label} Field Vial (${detail}0 Versatile Vials spent).`);
}

/**
 * Resolves the target PC actor and token from selection or assigned character.
 */
function resolveSelectedActorAndToken() {
    const controlled = canvas?.tokens?.controlled ?? [];
    let actor = null;
    let token = null;

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else if (controlled.length > 1) {
        ui.notifications.warn("Please select only one token to use Quick Alchemy.");
        return null;
    } else {
        ui.notifications.warn("Please select a character token first.");
        return null;
    }

    if (!actor || actor.type !== "character") {
        ui.notifications.warn("This macro only works on Player Character actors.");
        return null;
    }

    return { actor, token };
}

/**
 * Indexes `pf2e.equipment-srd` by UUID and ID for fast formula classification and artwork lookup.
 */
async function loadEquipmentSrdIndex() {
    const indexByUuid = new Map();
    const indexById = new Map();
    const pack = game.packs.get(VERSATILE_VIAL.PACK_ID);

    if (pack) {
        const index = await pack.getIndex({
            fields: [
                "system.level.value",
                "system.slug",
                "system.traits.value",
                "system.category",
                "system.consumableType.value",
                "type",
                "img"
            ]
        });
        for (const entry of index) {
            const entryUuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
            indexByUuid.set(entryUuid, entry);
            indexById.set(entry._id, entry);
        }
    }

    return { indexByUuid, indexById };
}

/**
 * Resolves and filters craftable alchemical consumable formulas from the actor's formula book.
 */
async function gatherCraftableFormulas(actor, actorLevel, { indexByUuid, indexById }) {
    const rawFormulas = Array.isArray(actor.system?.crafting?.formulas) ? actor.system.crafting.formulas : [];
    const formulaUuids = Array.from(new Set(
        rawFormulas.map(f => (typeof f === "string" ? f : f?.uuid)).filter(Boolean)
    ));

    const craftableFormulas = [];
    for (const uuid of formulaUuids) {
        let entry = indexByUuid.get(uuid);
        if (!entry) {
            const idMatch = uuid.match(/\.Item\.([a-zA-Z0-9]+)$/);
            if (idMatch && indexById.has(idMatch[1])) {
                entry = indexById.get(idMatch[1]);
            }
        }
        if (!entry) {
            try {
                entry = await fromUuid(uuid);
            } catch (err) {
                console.warn(`PF2e Easy Quick Alchemy | Could not resolve formula ${uuid}:`, err);
            }
        }
        if (!entry) continue;

        const level = Number(entry.system?.level?.value ?? entry.level ?? 0);
        if (level > actorLevel) continue;

        const traits = getTraitsArray(entry);
        const slug = (entry.system?.slug || entry.slug || "").toLowerCase();
        const type = entry.type;
        const category = (entry.system?.category || "").toLowerCase();

        // Skip Versatile Vial from regular formula list since Quick Vial is explicitly handled per tab
        if (slug === VERSATILE_VIAL.SLUG || uuid === VERSATILE_VIAL.UUID) continue;

        const isAlchemical = traits.includes("alchemical") || category === "alchemical";
        const isConsumableOrBomb = type === "consumable" ||
            traits.includes("consumable") ||
            traits.includes(ALCHEMICAL_CATEGORY.BOMB) ||
            category === ALCHEMICAL_CATEGORY.BOMB;
        if (!isAlchemical || !isConsumableOrBomb) continue;

        craftableFormulas.push({
            uuid,
            name: entry.name,
            img: entry.img || EASY_QUICK_ALCHEMY_MACRO_ICON,
            level,
            type,
            slug,
            category: classifyAlchemicalCategory(entry),
            familyKey: getFormulaFamilyKey(entry.name, slug, uuid)
        });
    }

    craftableFormulas.sort((a, b) => a.name.localeCompare(b.name) || (b.level - a.level));
    return craftableFormulas;
}

/**
 * Builds the Quick Vial / Research Field Vial rows available at 0 Versatile Vial cost.
 */
function buildQuickVialEntries(fields, vialDice, quickVialImg) {
    const bomberNote = fields[RESEARCH_FIELD.BOMBER] ? " acid/cold/elec/fire" : ` ${VERSATILE_VIAL.DEFAULT_DAMAGE_TYPE}`;
    const entries = [
        {
            id: QUICK_VIAL_ACTION.BOMB,
            category: ALCHEMICAL_CATEGORY.BOMB,
            name: `${VERSATILE_VIAL.TEMP_NAME} (Bomb Strike)`,
            subtitle: `Throws a temporary ${VERSATILE_VIAL.NAME} (${vialDice}d6${bomberNote}, ${vialDice} splash).`,
            img: quickVialImg,
            actionLabel: "Strike",
            badgeText: VERSATILE_VIAL.ZERO_VIAL_BADGE
        }
    ];

    for (const spec of Object.values(FIELD_VIAL_SPECS)) {
        if (!fields[spec.field]) continue;
        entries.push({
            id: spec.actionId,
            category: spec.category,
            name: spec.title,
            subtitle: spec.subtitle(vialDice),
            img: quickVialImg,
            actionLabel: spec.actionLabel,
            badgeText: VERSATILE_VIAL.ZERO_VIAL_BADGE
        });
    }

    return entries;
}

/**
 * Normalizes a formula name/slug by stripping recognized PF2e tier qualifiers
 * (Minor, Lesser, Moderate, Greater, Major, True, etc.) to group versions of the same item.
 */
function getFormulaFamilyKey(name, slug, fallbackKey) {
    let baseName = (name || "").trim();
    if (TIER_REGEX.PAREN.test(baseName)) {
        baseName = baseName.replace(TIER_REGEX.PAREN, "").trim();
    } else if (TIER_REGEX.PREFIX.test(baseName)) {
        baseName = baseName.replace(TIER_REGEX.PREFIX, "").trim();
    }

    const normalizedName = baseName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedName) return normalizedName;

    const baseSlug = (slug || "").trim().replace(TIER_REGEX.SLUG, "").trim();
    const normalizedSlug = baseSlug.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalizedSlug || fallbackKey;
}

/**
 * Filters a formula list down to only the highest-level entry per formula family.
 */
function filterHighestLevelFormulas(formulas) {
    const bestByFamily = new Map();
    for (const formula of formulas) {
        const key = formula.familyKey || formula.uuid;
        const currentBest = bestByFamily.get(key);
        if (!currentBest || formula.level > currentBest.level) {
            bestByFamily.set(key, formula);
        }
    }
    return Array.from(bestByFamily.values());
}

function getSavedSortOrder() {
    try {
        return game.settings.get(MODULE_ID, SETTING_KEYS.SORT_ORDER) || SORT_ORDER.NAME;
    } catch {
        return SORT_ORDER.NAME;
    }
}

function getSavedHighestLevelOnly() {
    try {
        const val = game.settings.get(MODULE_ID, SETTING_KEYS.HIGHEST_LEVEL_ONLY);
        return typeof val === "boolean" ? val : true;
    } catch {
        return true;
    }
}

function sortFormulas(formulas, sortMode) {
    if (sortMode === SORT_ORDER.LEVEL_DESC) {
        return formulas.sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    }
    if (sortMode === SORT_ORDER.LEVEL_ASC) {
        return formulas.sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
    }
    return formulas.sort((a, b) => a.name.localeCompare(b.name) || (b.level - a.level));
}

/**
 * Builds the static shell HTML for the Easy Quick Alchemy dialog.
 */
function buildDialogShellHtml({
    actor,
    actorLevel,
    fields,
    vialState,
    hasVials,
    target,
    displayedFormulas,
    quickVialItems,
    savedSortOrder,
    savedHighestOnly
}) {
    const countTab = (cat) => {
        if (cat === ALCHEMICAL_CATEGORY.ALL) return displayedFormulas.length + quickVialItems.length;
        return displayedFormulas.filter(f => f.category === cat).length +
            quickVialItems.filter(q => q.category === cat).length;
    };

    const activeFields = Object.entries(fields)
        .filter(([, active]) => active)
        .map(([key]) => RESEARCH_FIELD_LABELS[key]);

    const fieldBadgesHtml = activeFields.length > 0
        ? activeFields.map(label => `<span style="background: #1976d2; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">${escapeHtml(label)}</span>`).join(" ")
        : `<span style="background: #666; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">Quick Alchemy</span>`;

    const vialCountDisplay = vialState.max !== null ? `${vialState.count} / ${vialState.max}` : `${vialState.count}`;
    const vialStatusHtml = hasVials
        ? `<div style="padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
               <span><strong style="color: #2e7d32;">Versatile Vials: ${vialCountDisplay}</strong></span>
               <span style="font-size: 0.8em; color: #555;">Crafting a formula spends 1 Vial • ${VERSATILE_VIAL.TEMP_NAME} spends 0</span>
           </div>`
        : `<div style="padding: 6px 10px; background: rgba(198, 40, 40, 0.1); border-left: 3px solid #c62828; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
               <span><strong style="color: #c62828;">Versatile Vials: 0 remaining!</strong></span>
               <span style="font-size: 0.8em; color: #b71c1c;">Formulas locked — only ${VERSATILE_VIAL.TEMP_NAME} is available.</span>
           </div>`;

    const targetStatusHtml = target
        ? `<span style="color: #2e7d32; font-weight: bold;">✓ Target Selected</span>`
        : `<span style="color: #b75300;">No target selected (recommended for Bombs)</span>`;

    const renderOptions = (options, selectedValue) => options
        .map(opt => `<option value="${escapeHtml(opt.value)}"${opt.value === selectedValue ? " selected" : ""}>${escapeHtml(opt.label)}</option>`)
        .join("");

    const tabsHtml = Object.entries(CATEGORY_CONFIG)
        .map(([cat, cfg]) => {
            const bg = cat === ALCHEMICAL_CATEGORY.ALL ? "#fff" : "#e0e0e0";
            return `<button type="button" class="eqa-tab-btn" data-tab="${escapeHtml(cat)}" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: ${bg}; font-weight: bold; font-size: 0.85em;">${escapeHtml(cfg.tabLabel)} (${countTab(cat)})</button>`;
        })
        .join("");

    const bomberTypeSelectorHtml = fields[RESEARCH_FIELD.BOMBER]
        ? `<div style="display: flex; align-items: center; gap: 4px;">
               <label style="font-weight: bold;">${VERSATILE_VIAL.TEMP_NAME} Type:</label>
               <select id="eqa-bomber-type" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                   ${renderOptions(BOMBER_DAMAGE_TYPES, VERSATILE_VIAL.DEFAULT_DAMAGE_TYPE)}
               </select>
           </div>`
        : "";

    return `
        <div style="font-family: 'Signika', sans-serif; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85em; color: #444;">
                <div>
                    <strong>${escapeHtml(actor.name)}</strong> (Level ${actorLevel}) ${fieldBadgesHtml}
                </div>
                <div>${targetStatusHtml}</div>
            </div>

            ${vialStatusHtml}

            <div style="display: flex; border-bottom: 2px solid #ccc; gap: 3px; flex-wrap: wrap;">
                ${tabsHtml}
            </div>

            <div style="background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85em;">
                <div style="flex: 2; min-width: 160px;">
                    <input type="text" id="eqa-search-input" placeholder="Search known formulas..." style="width: 100%; height: 26px; padding: 2px 6px; border: 1px solid #ccc; border-radius: 3px;" />
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-weight: bold;">Sort:</label>
                    <select id="eqa-sort-select" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        ${renderOptions(SORT_OPTIONS, savedSortOrder)}
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-weight: bold;">Bomb MAP:</label>
                    <select id="eqa-map-select" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        ${renderOptions(MAP_OPTIONS, "0")}
                    </select>
                </div>
                ${bomberTypeSelectorHtml}
                <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-weight: bold; user-select: none;" title="Show only the highest-level version of each formula family">
                    <input type="checkbox" id="eqa-highest-only" ${savedHighestOnly ? "checked" : ""} style="margin: 0;" />
                    <span>Highest Level Only</span>
                </label>
            </div>

            <div id="eqa-list-container" style="height: 360px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; background: #fff; padding: 4px;">
            </div>
        </div>
    `;
}

/**
 * Renders the filtered Quick Vial and Known Formula list HTML.
 */
function buildFilteredListHtml({
    actorName,
    actorLevel,
    hasVials,
    activeTab,
    searchTxt,
    sortMode,
    quickVialItems,
    craftableFormulas
}) {
    const vialKeyword = VERSATILE_VIAL.NAME.toLowerCase();
    const visibleQuickVials = quickVialItems.filter(q => {
        if (activeTab !== ALCHEMICAL_CATEGORY.ALL && q.category !== activeTab) return false;
        if (searchTxt && !q.name.toLowerCase().includes(searchTxt) && !vialKeyword.includes(searchTxt)) return false;
        return true;
    });

    const visibleFormulas = sortFormulas(
        craftableFormulas.filter(f => {
            if (activeTab !== ALCHEMICAL_CATEGORY.ALL && f.category !== activeTab) return false;
            if (searchTxt && !f.name.toLowerCase().includes(searchTxt)) return false;
            return true;
        }),
        sortMode
    );

    let listHtml = "";

    if (visibleQuickVials.length > 0) {
        listHtml += `
            <div style="margin-bottom: 6px;">
                <div style="background: #eef6ee; border-left: 3px solid #2e7d32; padding: 3px 8px; font-weight: bold; font-size: 0.8em; text-transform: uppercase; color: #1b5e20;">
                    ${VERSATILE_VIAL.TEMP_NAME} (Creates ${VERSATILE_VIAL.NAME} — 0 Stocked Vials Spent)
                </div>
        `;
        for (const q of visibleQuickVials) {
            listHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 6px; border-bottom: 1px solid #e8f5e9; background: rgba(46, 125, 50, 0.03);">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                        <img src="${escapeHtml(q.img)}" width="26" height="26" style="border: none; border-radius: 3px; flex-shrink: 0;" />
                        <div style="overflow: hidden;">
                            <div style="font-weight: bold; font-size: 0.9em; color: #1b5e20;">${escapeHtml(q.name)}</div>
                            <div style="font-size: 0.78em; color: #555;">${escapeHtml(q.subtitle)}</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                        <span style="font-size: 0.75em; background: #e8f5e9; color: #2e7d32; padding: 2px 5px; border-radius: 3px; font-weight: bold;">${escapeHtml(q.badgeText)}</span>
                        <button type="button" class="eqa-quick-vial-btn" data-qv-id="${escapeHtml(q.id)}" style="padding: 3px 10px; font-size: 0.85em; font-weight: bold; cursor: pointer; background: #2e7d32; color: #fff; border: 1px solid #1b5e20; border-radius: 3px; width: auto; line-height: 1.4;">
                            ${escapeHtml(q.actionLabel)}
                        </button>
                    </div>
                </div>
            `;
        }
        listHtml += `</div>`;
    }

    if (visibleFormulas.length > 0) {
        listHtml += `
            <div>
                <div style="background: #eef2f5; border-left: 3px solid #1976d2; padding: 3px 8px; font-weight: bold; font-size: 0.8em; text-transform: uppercase; color: #0d47a1;">
                    Known Formulas (Spends 1 ${VERSATILE_VIAL.NAME})
                </div>
        `;
        for (const f of visibleFormulas) {
            const isBomb = f.category === ALCHEMICAL_CATEGORY.BOMB;
            const btnLabel = isBomb ? "Strike" : "Use";
            const disabledAttr = hasVials ? "" : "disabled";
            const btnStyle = hasVials
                ? `padding: 3px 10px; font-size: 0.85em; font-weight: bold; cursor: pointer; background: ${isBomb ? "#b71c1c" : "#1976d2"}; color: #fff; border: none; border-radius: 3px; width: auto; line-height: 1.4;`
                : `padding: 3px 10px; font-size: 0.85em; cursor: not-allowed; background: #ccc; color: #666; border: none; border-radius: 3px; width: auto; line-height: 1.4;`;
            const badgeLabel = CATEGORY_CONFIG[f.category]?.badgeLabel || CATEGORY_CONFIG[ALCHEMICAL_CATEGORY.OTHER].badgeLabel;

            listHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid #f0f0f0; ${hasVials ? "" : "opacity: 0.6;"}">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                        <img src="${escapeHtml(f.img)}" width="24" height="24" style="border: none; border-radius: 3px; flex-shrink: 0;" />
                        <span style="font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${escapeHtml(f.name)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                        <span style="font-size: 0.75em; background: rgba(0,0,0,0.05); color: #555; padding: 1px 5px; border-radius: 2px;">${escapeHtml(badgeLabel)}</span>
                        <span style="font-size: 0.75em; background: rgba(0,0,0,0.08); font-weight: bold; padding: 1px 5px; border-radius: 2px;">Lvl ${f.level}</span>
                        <a class="eqa-info-link" data-uuid="${escapeHtml(f.uuid)}" title="View Item Details" style="color: #666; cursor: pointer; padding: 0 2px;">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        <button type="button" class="eqa-craft-btn" data-uuid="${escapeHtml(f.uuid)}" style="${btnStyle}" ${disabledAttr} title="${hasVials ? "Craft and immediately use" : "No Versatile Vials remaining"}">
                            ${btnLabel}
                        </button>
                    </div>
                </div>
            `;
        }
        listHtml += `</div>`;
    } else {
        const emptyMsg = craftableFormulas.length === 0
            ? `No alchemical consumable formulas at or below Level ${actorLevel} found in ${escapeHtml(actorName)}'s formula book.`
            : "No matching formulas found in this category.";
        listHtml += `
            <div style="text-align: center; color: #777; padding: 20px; font-style: italic; font-size: 0.9em;">
                ${emptyMsg}
            </div>
        `;
    }

    return listHtml;
}

/**
 * Launches a Quick Vial Bomb Strike using either the actor's Versatile Vial or compendium template.
 */
async function launchQuickVialBomb({ actor, target, vialState, fields, mapIndex, bomberDamageType }) {
    let sourceObj = vialState.vialItem?.toObject();
    if (!sourceObj) {
        const compDoc = await fromUuid(VERSATILE_VIAL.UUID);
        if (!compDoc) {
            return ui.notifications.error(`Could not load ${VERSATILE_VIAL.NAME} from PF2e compendium.`);
        }
        sourceObj = compDoc.toObject();
    }

    const vialData = buildInfusedTempItemData(sourceObj, {
        isQuickVial: true,
        damageType: fields[RESEARCH_FIELD.BOMBER] ? bomberDamageType : null
    });
    await executeBombQuickAlchemy(actor, target, vialData, mapIndex, true);
}

/**
 * Main macro execution entry point for Easy Quick Alchemy.
 */
export async function executeEasyQuickAlchemy() {
    ensureTempItemCleanupHooks();

    const resolved = resolveSelectedActorAndToken();
    if (!resolved) return;
    const { actor, token } = resolved;

    // Purge stale or depleted temporary items before loading UI state
    await cleanupTempQuickAlchemyItems(actor, TIMING.STALE_TEMP_ITEM_MS);

    const actorLevel = Number(actor.system?.details?.level?.value ?? actor.level ?? 1);
    const vialDice = getVersatileVialDiceCount(actorLevel);
    const fields = getResearchFields(actor);
    const vialState = getVersatileVialState(actor);
    const hasVials = vialState.count > 0;
    let target = resolveCurrentTarget(null);

    const srdIndex = await loadEquipmentSrdIndex();
    const craftableFormulas = await gatherCraftableFormulas(actor, actorLevel, srdIndex);

    const quickVialImg =
        srdIndex.indexById.get(VERSATILE_VIAL.ITEM_ID)?.img ||
        srdIndex.indexByUuid.get(VERSATILE_VIAL.UUID)?.img ||
        vialState.vialItem?.img ||
        EASY_QUICK_ALCHEMY_MACRO_ICON;

    const quickVialItems = buildQuickVialEntries(fields, vialDice, quickVialImg);
    const highestLevelFormulas = filterHighestLevelFormulas(craftableFormulas);
    const savedSortOrder = getSavedSortOrder();
    const savedHighestOnly = getSavedHighestLevelOnly();

    let activeTab = ALCHEMICAL_CATEGORY.ALL;
    let dialogRef = null;

    const dialogContent = buildDialogShellHtml({
        actor,
        actorLevel,
        fields,
        vialState,
        hasVials,
        target,
        displayedFormulas: savedHighestOnly ? highestLevelFormulas : craftableFormulas,
        quickVialItems,
        savedSortOrder,
        savedHighestOnly
    });

    dialogRef = new Dialog({
        title: EASY_QUICK_ALCHEMY_MACRO_NAME,
        content: dialogContent,
        buttons: {
            cancel: { label: "Close" }
        },
        default: "cancel",
        render: (html) => {
            const getActiveFormulas = () =>
                html.find("#eqa-highest-only").is(":checked") ? highestLevelFormulas : craftableFormulas;

            const updateTabCounts = () => {
                const activeFormulas = getActiveFormulas();
                html.find(".eqa-tab-btn").each(function () {
                    const cat = $(this).data("tab");
                    const label = CATEGORY_CONFIG[cat]?.tabLabel || cat;
                    const count = cat === ALCHEMICAL_CATEGORY.ALL
                        ? activeFormulas.length + quickVialItems.length
                        : activeFormulas.filter(f => f.category === cat).length + quickVialItems.filter(q => q.category === cat).length;
                    $(this).text(`${label} (${count})`);
                });
            };

            const renderList = () => {
                const searchTxt = (html.find("#eqa-search-input").val() || "").trim().toLowerCase();
                const sortMode = html.find("#eqa-sort-select").val() || SORT_ORDER.NAME;
                html.find("#eqa-list-container").html(buildFilteredListHtml({
                    actorName: actor.name,
                    actorLevel,
                    hasVials,
                    activeTab,
                    searchTxt,
                    sortMode,
                    quickVialItems,
                    craftableFormulas: getActiveFormulas()
                }));
            };

            html.find(".eqa-tab-btn").on("click", function () {
                activeTab = $(this).data("tab");
                html.find(".eqa-tab-btn").each(function () {
                    const isCurrent = $(this).data("tab") === activeTab;
                    $(this).css({
                        "background": isCurrent ? "#fff" : "#e0e0e0",
                        "border-bottom": isCurrent ? "2px solid #fff" : "none"
                    });
                });
                renderList();
            });

            html.find("#eqa-search-input").on("input", renderList);
            html.find("#eqa-sort-select").on("change", async function () {
                const newSort = $(this).val() || SORT_ORDER.NAME;
                try {
                    await game.settings.set(MODULE_ID, SETTING_KEYS.SORT_ORDER, newSort);
                } catch (err) {
                    console.warn("PF2e Easy Quick Alchemy | Failed to persist sort order setting:", err);
                }
                renderList();
            });

            html.find("#eqa-highest-only").on("change", async function () {
                const highestOnly = $(this).is(":checked");
                try {
                    await game.settings.set(MODULE_ID, SETTING_KEYS.HIGHEST_LEVEL_ONLY, highestOnly);
                } catch (err) {
                    console.warn("PF2e Easy Quick Alchemy | Failed to persist highest-level-only setting:", err);
                }
                updateTabCounts();
                renderList();
            });

            html.on("click", ".eqa-info-link", async function (e) {
                e.preventDefault();
                e.stopPropagation();
                const uuid = $(this).data("uuid");
                if (uuid) {
                    const doc = await fromUuid(uuid);
                    if (doc?.sheet) doc.sheet.render(true);
                }
            });

            html.on("click", ".eqa-quick-vial-btn", async function () {
                const qvId = $(this).data("qv-id");
                const mapIndex = parseInt(html.find("#eqa-map-select").val(), 10) || 0;
                const bomberDamageType = html.find("#eqa-bomber-type").val() || VERSATILE_VIAL.DEFAULT_DAMAGE_TYPE;
                target = resolveCurrentTarget(target);
                dialogRef.close();

                if (qvId === QUICK_VIAL_ACTION.BOMB) {
                    await launchQuickVialBomb({ actor, target, vialState, fields, mapIndex, bomberDamageType });
                    return;
                }

                const matchedSpec = Object.values(FIELD_VIAL_SPECS).find(s => s.actionId === qvId);
                if (matchedSpec) {
                    await executeFieldVialAction(actor, token, target, matchedSpec.field, actorLevel, quickVialImg);
                }
            });

            html.on("click", ".eqa-craft-btn", async function () {
                const uuid = $(this).data("uuid");
                const formulaItem = craftableFormulas.find(f => f.uuid === uuid);
                if (!formulaItem) return;

                if (getVersatileVialState(actor).count < 1) {
                    return ui.notifications.warn("No Versatile Vials remaining! Only Quick Vial can be created.");
                }

                const mapIndex = parseInt(html.find("#eqa-map-select").val(), 10) || 0;
                target = resolveCurrentTarget(target);
                dialogRef.close();

                if (formulaItem.category === ALCHEMICAL_CATEGORY.BOMB) {
                    const sourceDoc = await fromUuid(formulaItem.uuid);
                    if (!sourceDoc) {
                        return ui.notifications.error(`Could not load formula document for ${formulaItem.name}.`);
                    }
                    const bombData = buildInfusedTempItemData(sourceDoc.toObject(), { isQuickVial: false });
                    await executeBombQuickAlchemy(actor, target, bombData, mapIndex, false);
                } else {
                    await executeConsumableQuickAlchemy(actor, token, formulaItem);
                }
            });

            renderList();
            html.find("#eqa-search-input").trigger("focus");
        }
    }, { width: 660, height: 590, resizable: true });

    dialogRef.render(true);
}
