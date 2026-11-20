/**
 * PF2e Hunt Prey Macro (Ranger)
 *
 * Features:
 * - Uses PF2e's built-in Hunt Prey action (`hunt-prey`) and posts it to chat.
 * - Applies PF2e's built-in "Effect: Hunt Prey" to the Ranger (if not already active).
 * - Adds a visible "Hunted Prey (<Ranger>)" token indicator effect (`slug: "effect-hunted-prey"`)
 *   onto the targeted enemy token via socketlib so the Ranger and party can clearly track prey on the canvas.
 * - Respects Double Prey (2 targets) and Triple Threat (3 targets), automatically removing the Ranger's
 *   oldest previous prey indicator when designating a new target beyond their limit without affecting
 *   other Rangers' marks.
 * - Designed to be called standalone or reused by other macros (Monster Hunter, Hunted Shot, Twin Takedown).
 */

export const HUNT_PREY_MACRO_NAME = "Hunt Prey";
export const HUNT_PREY_MACRO_ICON = "icons/svg/net.svg";

const MODULE_ID = "pf2e-awesome-macros-for-players";

const HUNT_PREY_REF = Object.freeze({
    ACTION_SLUG: "hunt-prey",
    ACTION_NAME: "Hunt Prey",
    ACTION_UUID: "Compendium.pf2e.actionspf2e.Item.Jyi4gnsAxsE5KxL1",
    EFFECT_NAME: "Effect: Hunt Prey",
    EFFECT_SLUG: "effect-hunt-prey",
    EFFECT_UUID: "Compendium.pf2e.feat-effects.Item.uX5hQZ3yE45u5Lmw",
    EFFECT_PACK: "pf2e.feat-effects",
    TARGET_INDICATOR_SLUG: "effect-hunted-prey",
    TARGET_INDICATOR_ICON: "icons/svg/net.svg",
    DOUBLE_PREY_SLUG: "double-prey",
    TRIPLE_THREAT_SLUG: "triple-threat"
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

/**
 * Returns the maximum number of simultaneous Hunted Prey targets the actor can maintain
 * (1 by default, 2 with Double Prey, 3 with Triple Threat).
 */
export function getMaxHuntedPreyCount(actor) {
    const feats = actor?.itemTypes?.feat ?? [];
    const hasFeat = (slug, nameLower) => feats.some(f =>
        (f.slug || f.system?.slug || "").toLowerCase() === slug ||
        (f.name || "").toLowerCase() === nameLower
    );

    if (hasFeat(HUNT_PREY_REF.TRIPLE_THREAT_SLUG, "triple threat")) return 3;
    if (hasFeat(HUNT_PREY_REF.DOUBLE_PREY_SLUG, "double prey")) return 2;
    return 1;
}

/**
 * Checks whether the actor has the Hunt Prey action or feat on their character sheet.
 */
export function hasHuntPreyAbility(actor) {
    if (!actor) return false;
    const matchesHuntPrey = (item) => {
        const slug = (item.slug || item.system?.slug || "").toLowerCase();
        const name = (item.name || "").toLowerCase();
        return slug === HUNT_PREY_REF.ACTION_SLUG || name === HUNT_PREY_REF.ACTION_NAME.toLowerCase();
    };

    return Boolean(
        actor.itemTypes?.action?.some(matchesHuntPrey) ||
        actor.itemTypes?.feat?.some(matchesHuntPrey) ||
        actor.items?.some(matchesHuntPrey)
    );
}

/**
 * Checks whether a specific effect document is a Hunted Prey target indicator belonging to a given Ranger.
 */
function isRangersPreyIndicator(effect, rangerActorId) {
    const flag = effect?.flags?.[MODULE_ID];
    return Boolean(flag?.isHuntPreyMark && (!rangerActorId || flag.rangerActorId === rangerActorId));
}

/**
 * Checks if Hunt Prey is active for the Ranger (and specifically on the given target when provided).
 * Verifies indicator ownership so another Ranger's Hunted Prey mark never counts for this actor.
 * Reused by Hunted Shot, Twin Takedown, and other Ranger macros.
 */
export function checkHuntPreyStatus(actor, target = null) {
    if (!actor) return false;

    const targetEffects = target?.actor?.itemTypes?.effect ?? [];

    // 1. Check module target indicators strictly by owning Ranger ID
    const targetMarkedByThisRanger = targetEffects.some(e => isRangersPreyIndicator(e, actor.id));
    if (targetMarkedByThisRanger) return true;

    // 2. Check non-module Hunted Prey effects, ignoring any indicator flagged to another Ranger
    //    and verifying origin.actor whenever present
    const targetHasGenericPreyEffect = targetEffects.some(e => {
        if (e.flags?.[MODULE_ID]?.isHuntPreyMark) return false;
        const originActorUuid = e.system?.context?.origin?.actor;
        if (originActorUuid && originActorUuid !== actor.uuid) return false;
        return e.slug === HUNT_PREY_REF.TARGET_INDICATOR_SLUG ||
            e.name === "Effect: Hunted Prey" ||
            e.name?.toLowerCase().includes("hunted prey");
    });
    if (targetHasGenericPreyEffect) return true;

    // 3. If this Ranger has our indicator placed on a DIFFERENT token in the scene,
    //    do not treat an unmarked target as their current Hunted Prey.
    if (target?.actor && canvas?.tokens?.placeables) {
        const hasMarkElsewhere = canvas.tokens.placeables.some(t =>
            t.id !== target.id &&
            t.actor?.id !== target.actor.id &&
            t.actor?.itemTypes?.effect?.some(e => isRangersPreyIndicator(e, actor.id))
        );
        if (hasMarkElsewhere) return false;
    }

    const actorHasEffect = actor.itemTypes?.effect?.some(e =>
        e.slug === HUNT_PREY_REF.EFFECT_SLUG ||
        e.name === HUNT_PREY_REF.EFFECT_NAME ||
        e.name?.toLowerCase().includes("hunt prey")
    ) ?? false;

    const rollOptions = actor.flags?.pf2e?.rollOptions?.all ?? {};
    const hasRollOption = Boolean(rollOptions["self:effect:hunt-prey"] || rollOptions["target:mark:hunt-prey"]);

    return actorHasEffect || hasRollOption;
}

/**
 * Fetches PF2e's built-in "Effect: Hunt Prey" item data from world items or compendiums.
 */
async function loadBuiltInHuntPreyEffectData() {
    const worldEffect = game.items.find(i =>
        i.type === "effect" &&
        (i.slug === HUNT_PREY_REF.EFFECT_SLUG || i.name === HUNT_PREY_REF.EFFECT_NAME)
    );
    if (worldEffect) return worldEffect.toObject();

    const effectDoc = await fromUuid(HUNT_PREY_REF.EFFECT_UUID);
    if (effectDoc) return effectDoc.toObject();

    const pack = game.packs.get(HUNT_PREY_REF.EFFECT_PACK);
    if (pack) {
        const index = await pack.getIndex({ fields: ["system.slug"] });
        const entry = index.find(e =>
            e.system?.slug === HUNT_PREY_REF.EFFECT_SLUG ||
            e.name === HUNT_PREY_REF.EFFECT_NAME
        );
        if (entry) {
            const compDoc = await pack.getDocument(entry._id);
            if (compDoc) return compDoc.toObject();
        }
    }

    return null;
}

/**
 * Collects unique actors from the active scene (plus an explicit target actor) to inspect existing marks.
 */
function collectSceneActors(targetActor) {
    const byUuid = new Map();
    if (targetActor?.uuid) {
        byUuid.set(targetActor.uuid, targetActor);
    }

    for (const tokenDoc of canvas?.scene?.tokens ?? []) {
        const tokenActor = tokenDoc.actor;
        if (tokenActor?.uuid && !byUuid.has(tokenActor.uuid)) {
            byUuid.set(tokenActor.uuid, tokenActor);
        }
    }

    return Array.from(byUuid.values());
}

/**
 * Socketlib GM handler: applies the "Hunted Prey" visual indicator effect to the target token's actor
 * and cleans up any older marks belonging to the same Ranger beyond their maxPrey limit.
 */
export async function applyHuntPreyIndicatorAsGM(targetTokenUuid, rangerActorUuid, rangerName, maxPrey = 1) {
    if (!targetTokenUuid || !rangerActorUuid) {
        return { success: false, error: "invalid_args" };
    }

    const resolvedTarget = await fromUuid(targetTokenUuid);
    const targetActor = resolvedTarget?.actor ?? resolvedTarget;
    if (!targetActor || typeof targetActor.createEmbeddedDocuments !== "function") {
        return { success: false, error: "target_not_found" };
    }

    const rangerActorId = rangerActorUuid.split(".").pop();
    const limit = Math.max(1, Number(maxPrey) || 1);

    // Check if the target already carries this Ranger's Hunted Prey mark
    const existingOnTarget = targetActor.itemTypes?.effect?.find(e => isRangersPreyIndicator(e, rangerActorId));
    if (existingOnTarget) {
        return { success: true, alreadyMarked: true, clearedCount: 0 };
    }

    // Find all existing Hunted Prey marks placed by THIS Ranger across the active scene
    const existingMarks = [];
    for (const sceneActor of collectSceneActors(targetActor)) {
        const effects = sceneActor.itemTypes?.effect ?? [];
        for (const eff of effects) {
            if (isRangersPreyIndicator(eff, rangerActorId)) {
                existingMarks.push({
                    actor: sceneActor,
                    effectId: eff.id,
                    markedAt: Number(eff.flags?.[MODULE_ID]?.markedAt ?? 0)
                });
            }
        }
    }

    // Remove the oldest mark(s) so adding this new target stays within maxPrey
    existingMarks.sort((a, b) => a.markedAt - b.markedAt);
    let clearedCount = 0;
    while (existingMarks.length >= limit) {
        const oldest = existingMarks.shift();
        try {
            await oldest.actor.deleteEmbeddedDocuments("Item", [oldest.effectId]);
            clearedCount++;
        } catch (err) {
            console.warn("PF2e Hunt Prey | Could not clear previous Hunted Prey indicator:", err);
        }
    }

    const safeRangerName = rangerName || "Ranger";
    const indicatorData = {
        type: "effect",
        name: `Hunted Prey (${safeRangerName})`,
        img: HUNT_PREY_REF.TARGET_INDICATOR_ICON,
        system: {
            slug: HUNT_PREY_REF.TARGET_INDICATOR_SLUG,
            level: { value: 1 },
            duration: {
                value: -1,
                unit: "unlimited",
                expiry: null,
                sustained: false
            },
            tokenIcon: {
                show: true
            },
            unidentified: false,
            description: {
                value: `<p>This creature is currently designated as the Hunted Prey of <strong>${escapeHtml(safeRangerName)}</strong>.</p>`
            },
            context: {
                origin: {
                    actor: rangerActorUuid
                }
            },
            rules: []
        },
        flags: {
            [MODULE_ID]: {
                isHuntPreyMark: true,
                rangerActorUuid,
                rangerActorId,
                rangerName: safeRangerName,
                markedAt: Date.now()
            }
        }
    };

    try {
        await targetActor.createEmbeddedDocuments("Item", [indicatorData]);
        return { success: true, alreadyMarked: false, clearedCount };
    } catch (err) {
        console.error("PF2e Hunt Prey | Failed to create target indicator effect:", err);
        return { success: false, error: "create_failed" };
    }
}

/**
 * Resolves the Ranger actor/token and single target token for Hunt Prey.
 */
function resolveRangerAndTarget(options = {}) {
    let token = options.token ?? null;
    let actor = options.actor ?? token?.actor ?? null;

    if (!actor) {
        const controlled = canvas?.tokens?.controlled ?? [];
        if (controlled.length === 1) {
            token = controlled[0];
            actor = token.actor;
        } else if (!game.user.isGM && game.user.character) {
            actor = game.user.character;
            token = actor.getActiveTokens()[0] ?? null;
        } else if (controlled.length > 1) {
            ui.notifications.info("Please select only one token to use Hunt Prey.");
            return null;
        } else {
            ui.notifications.info("Please select your token first.");
            return null;
        }
    }

    if (!actor) {
        ui.notifications.warn("No valid actor found for Hunt Prey.");
        return null;
    }

    let target = options.target ?? null;
    if (!target) {
        const targets = Array.from(game.user.targets ?? []);
        if (targets.length !== 1) {
            ui.notifications.info("Please target exactly one creature to designate as your Hunted Prey.");
            return null;
        }
        target = targets[0];
    }

    const targetActor = target?.actor ?? null;
    if (!targetActor) {
        ui.notifications.warn("Targeted token does not have a valid actor.");
        return null;
    }

    if (targetActor.id === actor.id || (token && target.id === token.id)) {
        ui.notifications.info("You cannot designate yourself as your own Hunted Prey.");
        return null;
    }

    return { actor, token, target };
}

/**
 * Executes Hunt Prey:
 * 1. Posts PF2e's built-in Hunt Prey action to chat.
 * 2. Applies PF2e's built-in "Effect: Hunt Prey" to the Ranger (re-creating if a native TokenMark needs updating).
 * 3. Places a visible "Hunted Prey (<Ranger>)" indicator effect onto the target token via socketlib.
 *
 * Can be called standalone or awaited from other macros (such as Monster Hunter, Hunted Shot, or Twin Takedown).
 */
export async function executeHuntPrey(options = {}) {
    const { postActionCard = true, notify = true } = options;

    const resolved = resolveRangerAndTarget(options);
    if (!resolved) return { success: false };

    const { actor, token, target } = resolved;

    if (!hasHuntPreyAbility(actor)) {
        ui.notifications.warn(`${actor.name} does not have Hunt Prey on their character sheet.`);
        return { success: false, reason: "missing_hunt_prey", actor, token, target };
    }

    const maxPrey = getMaxHuntedPreyCount(actor);

    // 1. Post PF2e's built-in Hunt Prey action to chat
    if (postActionCard) {
        const huntPreyItem =
            actor.itemTypes?.action?.find(a => a.slug === HUNT_PREY_REF.ACTION_SLUG || a.name === HUNT_PREY_REF.ACTION_NAME) ||
            actor.itemTypes?.feat?.find(f => f.slug === HUNT_PREY_REF.ACTION_SLUG || f.name === HUNT_PREY_REF.ACTION_NAME);

        if (huntPreyItem && typeof huntPreyItem.toMessage === "function") {
            await huntPreyItem.toMessage();
        } else {
            await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor, token }),
                content: `<strong>${escapeHtml(actor.name)}</strong> uses @UUID[${HUNT_PREY_REF.ACTION_UUID}]{Hunt Prey}!`
            });
        }
    }

    // 2. Apply PF2e's built-in "Effect: Hunt Prey" to the Ranger
    const existingSelfEffect = actor.itemTypes?.effect?.find(e =>
        e.slug === HUNT_PREY_REF.EFFECT_SLUG || e.name === HUNT_PREY_REF.EFFECT_NAME
    );

    if (!existingSelfEffect) {
        const effectData = await loadBuiltInHuntPreyEffectData();
        if (effectData) {
            effectData.system = effectData.system || {};
            if (effectData.system.duration) {
                effectData.system.duration.value = effectData.system.duration.value || 1;
            }
            await actor.createEmbeddedDocuments("Item", [effectData]);
        } else if (notify) {
            ui.notifications.warn(`Could not find "${HUNT_PREY_REF.EFFECT_NAME}" in the PF2e compendiums.`);
        }
    }

    // 3. Apply the visible target indicator on the prey token (via GM socketlib if player does not own target)
    const targetTokenDoc = target?.document ?? target;
    const targetTokenUuid = targetTokenDoc?.uuid ?? target?.actor?.uuid ?? null;
    let indicatorResult = { success: false };

    if (targetTokenUuid) {
        if (game.user.isGM || target?.actor?.isOwner) {
            indicatorResult = await applyHuntPreyIndicatorAsGM(targetTokenUuid, actor.uuid, actor.name, maxPrey);
        } else if (game.pf2eAwesomePlayerMacros?.applyHuntPreyIndicator) {
            indicatorResult = await game.pf2eAwesomePlayerMacros.applyHuntPreyIndicator(
                targetTokenUuid,
                actor.uuid,
                actor.name,
                maxPrey
            );
        } else {
            ui.notifications.warn("Could not place the Hunted Prey target indicator (socketlib / GM handler unavailable).");
        }
    }

    if (notify) {
        if (indicatorResult?.success) {
            if (indicatorResult.alreadyMarked) {
                ui.notifications.info(`Target is already marked as ${actor.name}'s Hunted Prey.`);
            } else {
                const movedNote = indicatorResult.clearedCount > 0 ? " (previous prey indicator cleared)" : "";
                ui.notifications.info(`Designated target as ${actor.name}'s Hunted Prey${movedNote}.`);
            }
        }
    }

    return {
        success: true,
        actor,
        token,
        target,
        maxPrey,
        alreadyMarked: Boolean(indicatorResult?.alreadyMarked),
        indicatorApplied: Boolean(indicatorResult?.success)
    };
}
