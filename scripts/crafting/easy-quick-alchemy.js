/**
 * PF2e Easy Quick Alchemy Macro (Alchemist - Remaster / Player Core 2)
 * 
 * Features:
 * - Detects active Alchemist / Quick Alchemy character and current Versatile Vial stock.
 * - Detects Research Field features on the character sheet (Bomber, Chirurgeon, Mutagenist, Toxicologist).
 * - Indexes known alchemical formulas in the character's formula book up to their current level.
 * - Organizes craftable items into clear filter tabs: All, Bombs, Elixirs, Mutagens, Poisons, Other,
 *   along with instant text search, level sorting, and MAP selection for bomb strikes.
 * - Formula Creation ("Create Consumable"):
 *     - Requires at least 1 Versatile Vial in inventory (blocks formula items when at 0 vials).
 *     - Deducts 1 Versatile Vial from inventory (preserving the item at 0 quantity rather than deleting it).
 *     - For Bombs: Temporarily creates the held infused bomb and opens Foundry's Strike roll dialog
 *       against the selected target (cancelling the attack dialog refunds the vial and removes the temp bomb).
 *     - For Elixirs, Mutagens, Poisons, and Other Consumables: Creates the infused item, auto-uses it
 *       to post its official item/effect card to chat, and cleans up the temporary inventory entry.
 * - Quick Vial ("Quick Vial" - 0 Versatile Vials Spent):
 *     - Remains available even when 0 Versatile Vials remain in inventory.
 *     - Bombs Tab: Throws a Quick Vial bomb Strike (supports Bomber elemental damage type selection).
 *     - Elixirs Tab (gated by Chirurgeon): Rolls Field Vial healing (1d6-4d6 by level) with native Heal card.
 *     - Mutagens Tab (gated by Mutagenist): Posts Field Vial activation card to suppress one mutagen drawback.
 *     - Poisons Tab (gated by Toxicologist): Posts Field Vial injury poison card with clickable damage roll.
 * - Auto-cleans up temporary Quick Alchemy / Quick Vial bomb items on combat turn progression / end.
 */

export const EASY_QUICK_ALCHEMY_MACRO_NAME = "Easy Quick Alchemy";
export const EASY_QUICK_ALCHEMY_MACRO_ICON = "systems/pf2e/icons/features/classes/alchemical-mastery.webp";

const MODULE_ID = "pf2e-awesome-macros-for-players";
const VERSATILE_VIAL_COMPENDIUM_UUID = "Compendium.pf2e.equipment-srd.Item.ljT5pe8D7rudJqus";

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return "";
    return String(unsafe)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

    const hasFeature = (slug, keyword) => {
        if (rollOptions[`feature:${slug}`] || rollOptions[`self:feature:${slug}`]) return true;
        return feats.some(f => {
            const s = (f.slug || f.system?.slug || "").toLowerCase();
            const n = (f.name || "").toLowerCase();
            return s === slug || s === `field-vials-${slug}` || n === keyword || n.includes(`(${keyword})`);
        });
    };

    return {
        bomber: hasFeature("bomber", "bomber"),
        chirurgeon: hasFeature("chirurgeon", "chirurgeon"),
        mutagenist: hasFeature("mutagenist", "mutagenist"),
        toxicologist: hasFeature("toxicologist", "toxicologist")
    };
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
        return slug === "versatile-vial" ||
            sourceId === VERSATILE_VIAL_COMPENDIUM_UUID ||
            (nameLower === "versatile vial" && (i.type === "weapon" || i.type === "consumable"));
    }) ?? null;

    const resource = actor.system?.resources?.versatileVials ?? null;
    const itemQty = vialItem ? Number(vialItem.system?.quantity ?? 0) : null;
    const resVal = resource ? Number(resource.value ?? 0) : null;

    const count = itemQty !== null ? itemQty : (resVal ?? 0);
    const max = resource?.max ?? null;

    return { vialItem, resource, count, max };
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
 * Removes stale or already-depleted (quantity <= 0) temporary Quick Alchemy items from an actor.
 */
async function cleanupTempQuickAlchemyItems(actor, maxAgeMs = 15000) {
    if (!actor?.isOwner) return;
    const now = Date.now();
    const staleIds = actor.items
        .filter(i => {
            const flag = i.flags?.[MODULE_ID];
            if (!flag?.quickAlchemyTemp) return false;
            const qty = Number(i.system?.quantity ?? 1);
            if (qty <= 0) return true;
            return !maxAgeMs || (now - (flag.createdAt || 0) >= maxAgeMs);
        })
        .map(i => i.id);

    if (staleIds.length > 0) {
        try {
            await actor.deleteEmbeddedDocuments("Item", staleIds);
        } catch (err) {
            console.warn("PF2e Easy Quick Alchemy | Failed to clean up temporary items:", err);
        }
    }
}

/**
 * Registers global hooks once per session to clean up temporary infused bomb items
 * when damage is rolled, when turns advance past their expiration, or when combat ends.
 */
function ensureTempItemCleanupHooks() {
    if (globalThis.__pf2eAwesomeQuickAlchemyCleanupHook) return;
    globalThis.__pf2eAwesomeQuickAlchemyCleanupHook = true;

    Hooks.on("createChatMessage", async (msg) => {
        if (msg?.flags?.pf2e?.context?.type !== "damage-roll") return;
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
            setTimeout(async () => {
                try {
                    const remainingIds = deleteIds.filter(id => actor.items.get(id));
                    if (remainingIds.length > 0) {
                        await actor.deleteEmbeddedDocuments("Item", remainingIds);
                    }
                } catch (err) {
                    console.warn("PF2e Easy Quick Alchemy | Post-damage cleanup warning:", err);
                }
            }, 300);
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

                // Clean up depleted (0 quantity) temporary items immediately on turn change
                if (Number(item.system?.quantity ?? 1) <= 0) {
                    expiredIds.push(item.id);
                    continue;
                }

                // Quick Vials expire as soon as the actor's turn ends; other temp items expire on next turn / later rounds
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

            if (expiredIds.length > 0) {
                try {
                    await actor.deleteEmbeddedDocuments("Item", expiredIds);
                } catch (err) {
                    console.warn("PF2e Easy Quick Alchemy | Turn cleanup warning:", err);
                }
            }
        }
    });

    Hooks.on("deleteCombat", async (combat) => {
        for (const combatant of combat.combatants ?? []) {
            const actor = combatant.actor;
            if (actor?.isOwner) {
                await cleanupTempQuickAlchemyItems(actor, 0);
            }
        }
    });
}

/**
 * Categorizes an alchemical item into bomb, mutagen, elixir, poison, or other.
 * Note: Mutagens also carry the 'elixir' trait in PF2e, so mutagens MUST be checked first.
 */
function classifyAlchemicalCategory(entry) {
    const traits = Array.isArray(entry.system?.traits?.value)
        ? entry.system.traits.value
        : (entry.traits?.value || []);
    const nameLower = (entry.name || "").toLowerCase();
    const category = (entry.system?.category || "").toLowerCase();
    const consumableType = (entry.system?.consumableType?.value || "").toLowerCase();

    if (traits.includes("bomb") || category === "bomb" || consumableType === "bomb") {
        return "bomb";
    }
    if (traits.includes("mutagen") || nameLower.includes("mutagen")) {
        return "mutagen";
    }
    if (traits.includes("elixir") || nameLower.includes("elixir")) {
        return "elixir";
    }
    if (traits.includes("poison") || category === "poison" || consumableType === "poison") {
        return "poison";
    }
    return "other";
}

/**
 * Prepares temporary item data cloned from a document/compendium entry.
 */
function buildInfusedTempItemData(sourceObj, { isQuickVial = false, damageType = null } = {}) {
    const data = globalThis.foundry?.utils?.deepClone
        ? foundry.utils.deepClone(sourceObj)
        : JSON.parse(JSON.stringify(sourceObj));

    delete data._id;
    if (data._stats) delete data._stats.compendiumSource;
    if (data.flags?.core) delete data.flags.core.sourceId;
    if (data.flags?.pf2e) delete data.flags.pf2e.sourceId;

    data.system = data.system || {};
    data.system.quantity = 1;

    // Ensure infused trait is present
    data.system.traits = data.system.traits || {};
    const traits = Array.isArray(data.system.traits.value) ? [...data.system.traits.value] : [];
    if (!traits.includes("infused")) traits.push("infused");

    if (isQuickVial) {
        data.name = "Quick Vial";
        if (damageType && ["acid", "cold", "electricity", "fire"].includes(damageType)) {
            const nonElementTraits = traits.filter(t => !["acid", "cold", "electricity", "fire"].includes(t));
            nonElementTraits.push(damageType);
            data.system.traits.value = nonElementTraits;
            if (data.system.damage) {
                data.system.damage.damageType = damageType;
            }
        } else {
            data.system.traits.value = traits;
        }
    } else {
        data.system.traits.value = traits;
    }

    // Ensure uses if present
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
async function executeBombQuickAlchemy(actor, token, target, itemData, mapIndex, isQuickVial) {
    if (!isQuickVial) {
        const vialState = getVersatileVialState(actor);
        if (vialState.count < 1) {
            return ui.notifications.warn("No Versatile Vials remaining! Only Quick Vial can be created.");
        }
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

    // Locate the compiled Strike on actor.system.actions
    let strike = actor.system?.actions?.find(a => a.type === "strike" && a.item?.id === createdBomb.id);
    if (!strike && typeof actor.prepareData === "function") {
        actor.prepareData();
        strike = actor.system?.actions?.find(a => a.type === "strike" && a.item?.id === createdBomb.id);
    }

    if (!strike || !strike.variants?.length) {
        await actor.deleteEmbeddedDocuments("Item", [createdBomb.id]);
        return ui.notifications.error(`Could not compile Strike action for ${createdBomb.name}.`);
    }

    const variantIdx = Math.min(Math.max(0, mapIndex), strike.variants.length - 1);
    reassertTarget(target);

    // Pop up Foundry's attack roll dialog against the target
    const rollResult = await strike.variants[variantIdx].roll({
        skipDialog: false,
        target: target?.object ?? target
    }) ?? null;

    if (!rollResult) {
        // User cancelled/closed the attack roll dialog — remove temp bomb and refund (do not spend vial)
        if (actor.items.get(createdBomb.id)) {
            await actor.deleteEmbeddedDocuments("Item", [createdBomb.id]);
        }
        ui.notifications.info(`${createdBomb.name} attack cancelled — Versatile Vial was not spent.`);
        return;
    }

    // Deduct 1 Versatile Vial only for non-Quick-Vial formula items
    if (!isQuickVial) {
        await consumeOneVersatileVial(actor);
        const remaining = getVersatileVialState(actor).count;
        ui.notifications.info(`Crafted & threw ${createdBomb.name} (1 Versatile Vial spent; ${remaining} remaining).`);
    } else {
        ui.notifications.info(`Quick Vial created & thrown (0 Versatile Vials spent).`);
    }

    // Out-of-combat safety cleanup in case attack misses and no damage roll is ever clicked
    if (!game.combat) {
        const tempBombId = createdBomb.id;
        setTimeout(async () => {
            try {
                if (actor.items.get(tempBombId)) {
                    await actor.deleteEmbeddedDocuments("Item", [tempBombId]);
                }
            } catch (err) {
                console.warn("PF2e Easy Quick Alchemy | Out-of-combat cleanup warning:", err);
            }
        }, 45000);
    }
}

/**
 * Executes a non-bomb formula consumable (Elixir, Mutagen, Poison, Other):
 * spends 1 Versatile Vial, creates the infused item, triggers consumption/chat card,
 * and ensures no temp item lingers in inventory.
 */
async function executeConsumableQuickAlchemy(actor, token, formulaItem) {
    const vialState = getVersatileVialState(actor);
    if (vialState.count < 1) {
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
                content: `
                    <div class="pf2e chat-card">
                        <header class="card-header flexrow">
                            <img src="${escapeHtml(formulaItem.img)}" width="36" height="36" style="border:none; margin-right:6px;"/>
                            <h3>${escapeHtml(formulaItem.name)}</h3>
                        </header>
                        <div class="card-content">
                            <p><strong>${escapeHtml(actor.name)}</strong> creates and uses @UUID[${formulaItem.uuid}]{${escapeHtml(formulaItem.name)}} via Quick Alchemy.</p>
                        </div>
                    </div>
                `
            });
        }
    } finally {
        // Ensure temporary item is cleaned up if consume() left it behind (e.g. autoDestroy false)
        if (actor.items.get(createdItem.id)) {
            await actor.deleteEmbeddedDocuments("Item", [createdItem.id]);
        }
    }

    const remaining = getVersatileVialState(actor).count;
    ui.notifications.info(`Used ${formulaItem.name} via Quick Alchemy (1 Versatile Vial spent; ${remaining} remaining).`);
}

/**
 * Executes a Research Field Quick Vial action (Chirurgeon, Mutagenist, Toxicologist) at 0 Versatile Vial cost.
 */
async function executeFieldVialAction(actor, token, target, fieldType, actorLevel) {
    const diceCount = getVersatileVialDiceCount(actorLevel);

    if (fieldType === "chirurgeon") {
        const targetTokenDoc = target?.document ?? target;
        const targetActorDoc = target?.actor ?? null;
        const targetData = targetTokenDoc?.uuid ? {
            token: targetTokenDoc.uuid,
            actor: targetActorDoc?.uuid ?? targetTokenDoc.actorId ?? null
        } : null;

        const flavorHtml = `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${EASY_QUICK_ALCHEMY_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:6px;"/>
                    <h3>Quick Vial: Chirurgeon Field Vial</h3>
                </header>
                <div class="card-content">
                    <div style="margin-bottom: 4px; font-size: 0.8em; color: #555;">
                        <strong>Traits:</strong> Alchemical, Coagulant, Elixir, Healing, Infused
                    </div>
                    <p style="margin: 4px 0; font-size: 0.9em;">
                        <strong>${escapeHtml(actor.name)}</strong> creates a Quick Vial to heal a living creature (drink or throw up to 20 ft. as an Interact action).
                    </p>
                </div>
            </div>
        `;

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
                ui.notifications.info(`Chirurgeon Field Vial healing rolled (${diceCount}d6; 0 Versatile Vials spent).`);
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
        return;
    }

    if (fieldType === "mutagenist") {
        const activeMutagens = actor.itemTypes?.effect?.filter(e => {
            const slug = (e.slug || e.system?.slug || "").toLowerCase();
            const name = (e.name || "").toLowerCase();
            const traits = e.system?.traits?.value ?? [];
            return slug.includes("mutagen") || name.includes("mutagen") || traits.includes("mutagen");
        }) ?? [];

        const activeMutagensHtml = activeMutagens.length > 0
            ? `<div style="margin-top: 6px; padding: 4px 8px; background: rgba(0,0,0,0.04); border-left: 3px solid #6a1b9a; font-size: 0.85em;">
                   <strong>Active Mutagens:</strong> ${activeMutagens.map(m => escapeHtml(m.name)).join(", ")}
               </div>`
            : `<div style="margin-top: 6px; font-size: 0.85em; color: #666; font-style: italic;">No active mutagen effects currently detected on ${escapeHtml(actor.name)}.</div>`;

        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor, token }),
            content: `
                <div class="pf2e chat-card">
                    <header class="card-header flexrow">
                        <img src="${EASY_QUICK_ALCHEMY_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:6px;"/>
                        <h3>Quick Vial: Mutagenist Field Vial</h3>
                    </header>
                    <div class="card-content">
                        <div style="margin-bottom: 4px; font-size: 0.8em; color: #555;">
                            <strong>Traits:</strong> Alchemical, Elixir, Infused
                        </div>
                        <p style="margin: 4px 0; font-size: 0.9em;">
                            <strong>${escapeHtml(actor.name)}</strong> drinks a Quick Vial to suppress the drawback from one mutagen currently affecting them for <strong>1 minute</strong>.
                        </p>
                        ${activeMutagensHtml}
                    </div>
                </div>
            `
        });
        ui.notifications.info("Used Mutagenist Field Vial (0 Versatile Vials spent).");
        return;
    }

    if (fieldType === "toxicologist") {
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor, token }),
            content: `
                <div class="pf2e chat-card">
                    <header class="card-header flexrow">
                        <img src="${EASY_QUICK_ALCHEMY_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:6px;"/>
                        <h3>Quick Vial: Toxicologist Field Vial</h3>
                    </header>
                    <div class="card-content">
                        <div style="margin-bottom: 4px; font-size: 0.8em; color: #555;">
                            <strong>Traits:</strong> Alchemical, Infused, Injury, Poison
                        </div>
                        <p style="margin: 4px 0; font-size: 0.9em;">
                            <strong>${escapeHtml(actor.name)}</strong> applies a Quick Vial to a weapon or piece of ammunition as an injury poison. It adds @Damage[${diceCount}d6[poison]] damage to the first successful Strike before becoming inert at the end of this turn.
                        </p>
                    </div>
                </div>
            `
        });
        ui.notifications.info(`Used Toxicologist Field Vial (${diceCount}d6 poison; 0 Versatile Vials spent).`);
    }
}

/**
 * Main macro execution entry point for Easy Quick Alchemy.
 */
export async function executeEasyQuickAlchemy() {
    ensureTempItemCleanupHooks();

    // 1. Identify Actor & Token
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else if (controlled.length > 1) {
        return ui.notifications.warn("Please select only one token to use Quick Alchemy.");
    } else {
        return ui.notifications.warn("Please select a character token first.");
    }

    if (!actor || actor.type !== "character") {
        return ui.notifications.warn("This macro only works on Player Character actors.");
    }

    // Clean up any stale or depleted temporary Quick Alchemy items from earlier out-of-combat sessions
    await cleanupTempQuickAlchemyItems(actor, 15000);

    const actorLevel = Number(actor.system?.details?.level?.value ?? actor.level ?? 1);
    const vialDice = getVersatileVialDiceCount(actorLevel);
    const fields = getResearchFields(actor);
    const vialState = getVersatileVialState(actor);
    const hasVials = vialState.count > 0;

    let target = Array.from(game.user.targets ?? [])[0] ?? null;

    // 2. Gather and classify craftable formulas from actor's formula book
    const rawFormulas = Array.isArray(actor.system?.crafting?.formulas) ? actor.system.crafting.formulas : [];
    const formulaUuids = Array.from(new Set(
        rawFormulas.map(f => (typeof f === "string" ? f : f?.uuid)).filter(Boolean)
    ));

    const pack = game.packs.get("pf2e.equipment-srd");
    const indexByUuid = new Map();
    const indexById = new Map();

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
                const doc = await fromUuid(uuid);
                if (doc) entry = doc;
            } catch (err) {
                console.warn(`PF2e Easy Quick Alchemy | Could not resolve formula ${uuid}:`, err);
            }
        }

        if (!entry) continue;

        const level = Number(entry.system?.level?.value ?? entry.level ?? 0);
        if (level > actorLevel) continue;

        const traits = Array.isArray(entry.system?.traits?.value)
            ? entry.system.traits.value
            : (entry.traits?.value || []);
        const slug = (entry.system?.slug || entry.slug || "").toLowerCase();
        const type = entry.type;
        const category = (entry.system?.category || "").toLowerCase();

        // Skip Versatile Vial from regular formula list since Quick Vial is explicitly handled per tab
        if (slug === "versatile-vial" || uuid === VERSATILE_VIAL_COMPENDIUM_UUID) continue;

        const isAlchemical = traits.includes("alchemical") || category === "alchemical";
        const isConsumableOrBomb = type === "consumable" || traits.includes("consumable") || traits.includes("bomb") || category === "bomb";

        if (!isAlchemical || !isConsumableOrBomb) continue;

        const subcat = classifyAlchemicalCategory(entry);
        craftableFormulas.push({
            uuid,
            name: entry.name,
            img: entry.img || EASY_QUICK_ALCHEMY_MACRO_ICON,
            level,
            type,
            slug,
            category: subcat
        });
    }

    // Sort cleanly: alphabetically by name, then highest level first
    craftableFormulas.sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) return nameCmp;
        return b.level - a.level;
    });

    const quickVialImg =
        indexById.get("ljT5pe8D7rudJqus")?.img ||
        indexByUuid.get(VERSATILE_VIAL_COMPENDIUM_UUID)?.img ||
        vialState.vialItem?.img ||
        EASY_QUICK_ALCHEMY_MACRO_ICON;

    // 3. Build Special Quick Vial entries (gated by research field where applicable)
    const quickVialItems = [
        {
            id: "quick-vial-bomb",
            category: "bomb",
            name: "Quick Vial (Bomb Strike)",
            subtitle: `Throws a temporary Versatile Vial (${vialDice}d6${fields.bomber ? " acid/cold/elec/fire" : " acid"}, ${vialDice} splash).`,
            img: quickVialImg,
            actionLabel: "Strike",
            badgeText: "Uses 0 Vials (Quick Vial)"
        }
    ];

    if (fields.chirurgeon) {
        quickVialItems.push({
            id: "quick-vial-chirurgeon",
            category: "elixir",
            name: "Quick Vial: Chirurgeon Field Vial",
            subtitle: `Heals a living creature for ${vialDice}d6 HP (drink or throw 20 ft.).`,
            img: quickVialImg,
            actionLabel: "Heal",
            badgeText: "Uses0 Vials (Quick Vial)"
        });
    }

    if (fields.mutagenist) {
        quickVialItems.push({
            id: "quick-vial-mutagenist",
            category: "mutagen",
            name: "Quick Vial: Mutagenist Field Vial",
            subtitle: "Suppresses the drawback of one active mutagen for 1 minute.",
            img: quickVialImg,
            actionLabel: "Drink",
            badgeText: "Uses 0 Vials (Quick Vial)"
        });
    }

    if (fields.toxicologist) {
        quickVialItems.push({
            id: "quick-vial-toxicologist",
            category: "poison",
            name: "Quick Vial: Toxicologist Field Vial",
            subtitle: `Applies ${vialDice}d6 poison damage to a weapon/ammo until end of turn.`,
            img: quickVialImg,
            actionLabel: "Apply",
            badgeText: "Uses 0 Vials (Quick Vial)"
        });
    }

    // Count items per tab
    const countTab = (cat) => {
        if (cat === "all") return craftableFormulas.length + quickVialItems.length;
        return craftableFormulas.filter(f => f.category === cat).length + quickVialItems.filter(q => q.category === cat).length;
    };

    const activeFieldsList = Object.entries(fields)
        .filter(([, active]) => active)
        .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

    const fieldBadgesHtml = activeFieldsList.length > 0
        ? activeFieldsList.map(f => `<span style="background: #1976d2; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">${escapeHtml(f)}</span>`).join(" ")
        : `<span style="background: #666; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">Quick Alchemy</span>`;

    const vialCountDisplay = vialState.max !== null ? `${vialState.count} / ${vialState.max}` : `${vialState.count}`;
    const vialStatusHtml = hasVials
        ? `<div style="padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
               <span><strong style="color: #2e7d32;">Versatile Vials: ${vialCountDisplay}</strong></span>
               <span style="font-size: 0.8em; color: #555;">Crafting a formula spends 1 Vial • Quick Vial spends 0</span>
           </div>`
        : `<div style="padding: 6px 10px; background: rgba(198, 40, 40, 0.1); border-left: 3px solid #c62828; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
               <span><strong style="color: #c62828;">Versatile Vials: 0 remaining!</strong></span>
               <span style="font-size: 0.8em; color: #b71c1c;">Formulas locked — only Quick Vial is available.</span>
           </div>`;

    const targetStatusHtml = target
        ? `<span style="color: #2e7d32; font-weight: bold;">✓ Target Selected</span>`
        : `<span style="color: #b75300;">No target selected (recommended for Bombs)</span>`;

    const bomberTypeSelectorHtml = fields.bomber
        ? `<div style="display: flex; align-items: center; gap: 4px;">
               <label style="font-weight: bold;">Quick Vial Type:</label>
               <select id="eqa-bomber-type" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                   <option value="acid">Acid</option>
                   <option value="cold">Cold</option>
                   <option value="electricity">Electricity</option>
                   <option value="fire">Fire</option>
               </select>
           </div>`
        : "";

    let savedSortOrder = "name";
    try {
        savedSortOrder = game.settings.get(MODULE_ID, "quickAlchemySortOrder") || "name";
    } catch {
        savedSortOrder = "name";
    }

    let activeTab = "all";
    let dialogRef = null;

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif; display: flex; flex-direction: column; gap: 8px;">
            <!-- Header Bar -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85em; color: #444;">
                <div>
                    <strong>${escapeHtml(actor.name)}</strong> (Level ${actorLevel}) ${fieldBadgesHtml}
                </div>
                <div>${targetStatusHtml}</div>
            </div>

            ${vialStatusHtml}

            <!-- Category Tabs -->
            <div style="display: flex; border-bottom: 2px solid #ccc; gap: 3px; flex-wrap: wrap;">
                <button type="button" class="eqa-tab-btn" data-tab="all" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #fff; font-weight: bold; font-size: 0.85em;">All (${countTab("all")})</button>
                <button type="button" class="eqa-tab-btn" data-tab="bomb" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #e0e0e0; font-weight: bold; font-size: 0.85em;">Bombs (${countTab("bomb")})</button>
                <button type="button" class="eqa-tab-btn" data-tab="elixir" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #e0e0e0; font-weight: bold; font-size: 0.85em;">Elixirs (${countTab("elixir")})</button>
                <button type="button" class="eqa-tab-btn" data-tab="mutagen" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #e0e0e0; font-weight: bold; font-size: 0.85em;">Mutagens (${countTab("mutagen")})</button>
                <button type="button" class="eqa-tab-btn" data-tab="poison" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #e0e0e0; font-weight: bold; font-size: 0.85em;">Poisons (${countTab("poison")})</button>
                <button type="button" class="eqa-tab-btn" data-tab="other" style="flex: 1; padding: 5px 6px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; border-radius: 4px 4px 0 0; background: #e0e0e0; font-weight: bold; font-size: 0.85em;">Other (${countTab("other")})</button>
            </div>

            <!-- Filter & Combat Options Toolbar -->
            <div style="background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85em;">
                <div style="flex: 2; min-width: 160px;">
                    <input type="text" id="eqa-search-input" placeholder="Search known formulas..." style="width: 100%; height: 26px; padding: 2px 6px; border: 1px solid #ccc; border-radius: 3px;" />
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-weight: bold;">Sort:</label>
                    <select id="eqa-sort-select" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        <option value="name"${savedSortOrder === "name" ? " selected" : ""}>Name (A-Z)</option>
                        <option value="level-desc"${savedSortOrder === "level-desc" ? " selected" : ""}>Level (High - Low)</option>
                        <option value="level-asc"${savedSortOrder === "level-asc" ? " selected" : ""}>Level (Low - High)</option>
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-weight: bold;">Bomb MAP:</label>
                    <select id="eqa-map-select" style="height: 26px; border: 1px solid #ccc; border-radius: 3px;">
                        <option value="0" selected>No MAP</option>
                        <option value="1">MAP -5 (-4 Agile)</option>
                        <option value="2">MAP -10 (-8 Agile)</option>
                    </select>
                </div>
                ${bomberTypeSelectorHtml}
            </div>

            <!-- Scrollable Items Container -->
            <div id="eqa-list-container" style="height: 360px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; background: #fff; padding: 4px;">
                <!-- Dynamically filled -->
            </div>
        </div>
    `;

    const CATEGORY_LABELS = {
        bomb: "Bomb",
        elixir: "Elixir",
        mutagen: "Mutagen",
        poison: "Poison",
        other: "Alchemical"
    };

    dialogRef = new Dialog({
        title: "Easy Quick Alchemy",
        content: dialogContent,
        buttons: {
            cancel: {
                label: "Close"
            }
        },
        default: "cancel",
        render: (html) => {
            const renderList = () => {
                const searchTxt = (html.find("#eqa-search-input").val() || "").trim().toLowerCase();
                const sortMode = html.find("#eqa-sort-select").val() || "name";

                // 1. Filter Quick Vial entries
                const visibleQuickVials = quickVialItems.filter(q => {
                    if (activeTab !== "all" && q.category !== activeTab) return false;
                    if (searchTxt && !q.name.toLowerCase().includes(searchTxt) && !"versatile vial".includes(searchTxt)) return false;
                    return true;
                });

                // 2. Filter Known Formulas
                const visibleFormulas = craftableFormulas.filter(f => {
                    if (activeTab !== "all" && f.category !== activeTab) return false;
                    if (searchTxt && !f.name.toLowerCase().includes(searchTxt)) return false;
                    return true;
                });

                if (sortMode === "level-desc") {
                    visibleFormulas.sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
                } else if (sortMode === "level-asc") {
                    visibleFormulas.sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));
                } else {
                    visibleFormulas.sort((a, b) => a.name.localeCompare(b.name) || (b.level - a.level));
                }

                let listHtml = "";

                // Quick Vial Section
                if (visibleQuickVials.length > 0) {
                    listHtml += `
                        <div style="margin-bottom: 6px;">
                            <div style="background: #eef6ee; border-left: 3px solid #2e7d32; padding: 3px 8px; font-weight: bold; font-size: 0.8em; text-transform: uppercase; color: #1b5e20;">
                                Quick Vial (Creates Versatile Vial — 0 Stocked Vials Spent)
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

                // Known Formulas Section
                if (visibleFormulas.length > 0) {
                    listHtml += `
                        <div>
                            <div style="background: #eef2f5; border-left: 3px solid #1976d2; padding: 3px 8px; font-weight: bold; font-size: 0.8em; text-transform: uppercase; color: #0d47a1;">
                                Known Formulas (Spends 1 Versatile Vial)
                            </div>
                    `;
                    for (const f of visibleFormulas) {
                        const isBomb = f.category === "bomb";
                        const btnLabel = isBomb ? "Strike" : "Use";
                        const disabledAttr = hasVials ? "" : "disabled";
                        const btnStyle = hasVials
                            ? `padding: 3px 10px; font-size: 0.85em; font-weight: bold; cursor: pointer; background: ${isBomb ? "#b71c1c" : "#1976d2"}; color: #fff; border: none; border-radius: 3px; width: auto; line-height: 1.4;`
                            : `padding: 3px 10px; font-size: 0.85em; cursor: not-allowed; background: #ccc; color: #666; border: none; border-radius: 3px; width: auto; line-height: 1.4;`;

                        listHtml += `
                            <div style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid #f0f0f0; ${hasVials ? "" : "opacity: 0.6;"}">
                                <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                                    <img src="${escapeHtml(f.img)}" width="24" height="24" style="border: none; border-radius: 3px; flex-shrink: 0;" />
                                    <span style="font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${escapeHtml(f.name)}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                                    <span style="font-size: 0.75em; background: rgba(0,0,0,0.05); color: #555; padding: 1px 5px; border-radius: 2px;">${CATEGORY_LABELS[f.category] || "Alchemical"}</span>
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
                        ? `No alchemical consumable formulas at or below Level ${actorLevel} found in ${escapeHtml(actor.name)}'s formula book.`
                        : "No matching formulas found in this category.";
                    listHtml += `
                        <div style="text-align: center; color: #777; padding: 20px; font-style: italic; font-size: 0.9em;">
                            ${emptyMsg}
                        </div>
                    `;
                }

                html.find("#eqa-list-container").html(listHtml);
            };

            // Tab switching
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

            // Filter & Sort updates
            html.find("#eqa-search-input").on("input", renderList);
            html.find("#eqa-sort-select").on("change", async function () {
                const newSort = $(this).val() || "name";
                try {
                    await game.settings.set(MODULE_ID, "quickAlchemySortOrder", newSort);
                } catch (err) {
                    console.warn("PF2e Easy Quick Alchemy | Failed to persist sort order setting:", err);
                }
                renderList();
            });

            // Inspect item sheet
            html.on("click", ".eqa-info-link", async function (e) {
                e.preventDefault();
                e.stopPropagation();
                const uuid = $(this).data("uuid");
                if (uuid) {
                    const doc = await fromUuid(uuid);
                    if (doc?.sheet) doc.sheet.render(true);
                }
            });

            // Quick Vial button click
            html.on("click", ".eqa-quick-vial-btn", async function () {
                const qvId = $(this).data("qv-id");
                const mapIndex = parseInt(html.find("#eqa-map-select").val(), 10) || 0;
                const bomberDamageType = html.find("#eqa-bomber-type").val() || "acid";

                // Re-check canvas target in case user targeted an enemy while dialog was open
                if (!target && game.user.targets?.size > 0) {
                    target = Array.from(game.user.targets)[0];
                }

                dialogRef.close();

                if (qvId === "quick-vial-bomb") {
                    let sourceObj = vialState.vialItem?.toObject();
                    if (!sourceObj) {
                        const compDoc = await fromUuid(VERSATILE_VIAL_COMPENDIUM_UUID);
                        if (!compDoc) {
                            return ui.notifications.error("Could not load Versatile Vial from PF2e compendium.");
                        }
                        sourceObj = compDoc.toObject();
                    }
                    const vialData = buildInfusedTempItemData(sourceObj, {
                        isQuickVial: true,
                        damageType: fields.bomber ? bomberDamageType : null
                    });
                    await executeBombQuickAlchemy(actor, token, target, vialData, mapIndex, true);
                } else if (qvId === "quick-vial-chirurgeon") {
                    await executeFieldVialAction(actor, token, target, "chirurgeon", actorLevel);
                } else if (qvId === "quick-vial-mutagenist") {
                    await executeFieldVialAction(actor, token, target, "mutagenist", actorLevel);
                } else if (qvId === "quick-vial-toxicologist") {
                    await executeFieldVialAction(actor, token, target, "toxicologist", actorLevel);
                }
            });

            // Formula Craft & Use button click
            html.on("click", ".eqa-craft-btn", async function () {
                const uuid = $(this).data("uuid");
                const formulaItem = craftableFormulas.find(f => f.uuid === uuid);
                if (!formulaItem) return;

                if (getVersatileVialState(actor).count < 1) {
                    return ui.notifications.warn("No Versatile Vials remaining! Only Quick Vial can be created.");
                }

                const mapIndex = parseInt(html.find("#eqa-map-select").val(), 10) || 0;
                if (!target && game.user.targets?.size > 0) {
                    target = Array.from(game.user.targets)[0];
                }

                dialogRef.close();

                if (formulaItem.category === "bomb") {
                    const sourceDoc = await fromUuid(formulaItem.uuid);
                    if (!sourceDoc) {
                        return ui.notifications.error(`Could not load formula document for ${formulaItem.name}.`);
                    }
                    const bombData = buildInfusedTempItemData(sourceDoc.toObject(), { isQuickVial: false });
                    await executeBombQuickAlchemy(actor, token, target, bombData, mapIndex, false);
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
