/**
 * PF2e Martial Performance Macro (Bard - Warrior Muse)
 * 
 * Rules (Pathfinder Player Core / Remaster - Bard Feat / Warrior Muse):
 * - Requirements: You are affected by a composition cantrip you cast this turn
 *   that has a duration of 1 round.
 * - Effect: You make a Strike. If it hits, you increase the duration of the
 *   composition cantrip by 1 round (to a maximum of 3 rounds).
 * 
 * Macro Features:
 * - Detects active token/actor.
 * - Finds all active composition cantrip effects (Courageous Anthem, Rallying Anthem,
 *   Song of Strength, Dirge of Doom, etc.) on the caster and all selected tokens
 *   (or all allies within 60 ft if only the caster is selected).
 * - Increments the duration of active anthem effects by +1 round.
 * - Uses socketlib as GM to update durations on all players without permission blocks.
 * - Posts a stylish chat message detailing the updated remaining durations.
 */

export const MARTIAL_PERFORMANCE_MACRO_NAME = "Martial Performance";
export const MARTIAL_PERFORMANCE_MACRO_ICON = "icons/skills/trades/music-singing-voice-blue.webp";

/**
 * Slugs and keywords representing composition cantrip effects.
 */
const ANTHEM_SLUGS = [
    "spell-effect-courageous-anthem",
    "spell-effect-inspire-courage",
    "spell-effect-rallying-anthem",
    "spell-effect-inspire-defense",
    "spell-effect-song-of-strength",
    "spell-effect-triple-time",
    "spell-effect-uplifting-overture",
    "spell-effect-allegro",
    "spell-effect-dirge-of-doom",
    "spell-effect-song-of-marching",
    "spell-effect-house-of-imaginary-walls"
];

/**
 * Checks if an effect document is an anthem or composition effect.
 */
function isAnthemEffect(effect) {
    if (!effect) return false;
    const slug = effect.slug || effect.system?.slug || "";
    if (ANTHEM_SLUGS.includes(slug)) return true;
    if (slug.includes("anthem") || slug.includes("inspire") || slug.includes("song-of-") || slug.includes("triple-time") || slug.includes("overture") || slug.includes("allegro")) return true;
    const name = effect.name?.toLowerCase() || "";
    if (name.includes("anthem") || name.includes("inspire") || name.includes("song of") || name.includes("triple time") || name.includes("overture") || name.includes("allegro") || name.includes("dirge of doom")) return true;
    return false;
}

/**
 * Socketlib handler to increment the duration of an anthem effect on any actor as GM.
 */
export async function extendAnthemDurationAsGM(targetActorUuid, effectId, deltaRounds = 1) {
    if (!targetActorUuid) return null;
    const doc = await fromUuid(targetActorUuid);
    const targetActor = doc?.actor ?? doc;
    if (!targetActor) return null;

    let effect = null;
    if (effectId) {
        effect = targetActor.items.get(effectId);
    }
    if (!effect) {
        effect = targetActor.itemTypes.effect.find(e => isAnthemEffect(e));
    }
    if (!effect) return null;

    const currentVal = effect.system?.duration?.value ?? 1;
    const newVal = Math.max(1, currentVal + deltaRounds);

    try {
        await effect.update({ "system.duration.value": newVal });
        return {
            success: true,
            actorName: targetActor.name,
            effectName: effect.name,
            oldDuration: currentVal,
            newDuration: newVal
        };
    } catch (err) {
        console.error("PF2e Martial Performance | Failed to update effect duration", err);
        return null;
    }
}

/**
 * Main macro execution.
 */
export async function executeMartialPerformance() {
    // 1. Get Actor and Token
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length > 0) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else {
        return ui.notifications.warn("Please select your character's token first.");
    }

    if (!actor) {
        return ui.notifications.warn("No valid actor found.");
    }

    // 2. Identify Target Actors to extend
    // If multiple tokens are selected, check all of them.
    // If only 1 token is selected, check caster and all allies within 60 ft that have an anthem effect.
    const targetActors = [];

    if (controlled.length > 1) {
        for (const t of controlled) {
            if (t.actor && !targetActors.some(a => a.id === t.actor.id)) {
                targetActors.push(t.actor);
            }
        }
    } else {
        targetActors.push(actor);
        if (token && canvas?.tokens?.placeables) {
            for (const t of canvas.tokens.placeables) {
                if (!t.actor || t.id === token.id) continue;
                const isAlly = t.actor.hasPlayerOwner || t.document.disposition >= 1 || t.actor.type === "character";
                if (!isAlly) continue;
                // Check if they currently have an active anthem effect
                const hasAnthem = t.actor.itemTypes?.effect?.some(e => isAnthemEffect(e));
                if (hasAnthem && !targetActors.some(a => a.id === t.actor.id)) {
                    targetActors.push(t.actor);
                }
            }
        }
    }

    // 3. Find which actors actually have an active anthem effect
    const updatesToApply = [];
    for (const a of targetActors) {
        const anthemEffects = a.itemTypes?.effect?.filter(e => isAnthemEffect(e)) ?? [];
        for (const eff of anthemEffects) {
            updatesToApply.push({
                actor: a,
                effect: eff,
                currentDuration: eff.system?.duration?.value ?? 1
            });
        }
    }

    if (updatesToApply.length === 0) {
        return ui.notifications.warn("No active composition cantrip effects found on the selected character(s) or nearby allies.");
    }

    // 4. Confirmation Dialog
    const effectsSummaryHtml = updatesToApply.map(u => {
        const nextVal = u.currentDuration + 1;
        return `
            <div style="padding: 4px 6px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                <span><strong>${u.actor.name}:</strong> ${u.effect.name}</span>
                <span style="color: #2e7d32; font-weight: bold;">${u.currentDuration} round(s) → ${nextVal} rounds</span>
            </div>
        `;
    }).join("");

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; font-size: 0.95em;">
                Extend the duration of active anthem effects by <strong>+1 round</strong> via <strong>Martial Performance</strong>:
            </p>
            <div style="max-height: 160px; overflow-y: auto; border: 1px solid #ccc; border-radius: 4px; background: #fafafa; margin-bottom: 10px;">
                ${effectsSummaryHtml}
            </div>
            <p style="font-size: 0.85em; color: #555; margin: 0; font-style: italic;">
                Warrior Muse allows you to extend your composition cantrip by 1 round after a successful Strike.
            </p>
        </div>
    `;

    new Dialog({
        title: "Martial Performance: Extend Anthem",
        content: dialogContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            },
            extend: {
                icon: '<i class="fas fa-plus"></i>',
                label: "Extend (+1 Round)",
                callback: async () => {
                    await applyMartialPerformanceExtension(actor, token, updatesToApply);
                }
            }
        },
        default: "extend"
    }).render(true);
}

/**
 * Applies the +1 round duration extension to all specified effects and posts chat message.
 */
async function applyMartialPerformanceExtension(casterActor, casterToken, updatesToApply) {
    const results = [];

    for (const item of updatesToApply) {
        const { actor, effect, currentDuration } = item;
        let res = null;

        if (actor.isOwner) {
            const nextVal = currentDuration + 1;
            try {
                await effect.update({ "system.duration.value": nextVal });
                res = {
                    actorName: actor.name,
                    effectName: effect.name,
                    oldDuration: currentDuration,
                    newDuration: nextVal
                };
            } catch (err) {
                console.warn("PF2e Martial Performance | Could not update own effect", err);
            }
        } else if (game.pf2eAwesomePlayerMacros?.extendAnthemDuration) {
            res = await game.pf2eAwesomePlayerMacros.extendAnthemDuration(actor.uuid, effect.id, 1);
        }

        if (res) {
            results.push(res);
        }
    }

    if (results.length === 0) {
        return ui.notifications.error("Could not update the duration on any target actors.");
    }

    // Post Chat Card
    const targetRowsHtml = results.map(r => `
        <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dotted #ccc; font-size: 0.9em;">
            <span><strong>${r.actorName}</strong> (${r.effectName})</span>
            <span style="font-weight: bold; color: #2e7d32;">${r.oldDuration} → ${r.newDuration} rounds</span>
        </div>
    `).join("");

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: casterActor, token: casterToken }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${MARTIAL_PERFORMANCE_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Martial Performance</h3>
                </header>
                <div class="card-content">
                    <p style="margin-bottom: 6px;">
                        <strong>${casterActor.name}</strong> strikes true and channels martial music to extend their composition cantrip!
                    </p>
                    <div style="margin-bottom: 6px; padding: 6px 10px; background: rgba(0,0,0,0.04); border-left: 3px solid #f57c00; border-radius: 3px;">
                        <div style="font-weight: bold; color: #b75300; font-size: 0.95em; margin-bottom: 4px;">Duration Extended (+1 Round):</div>
                        ${targetRowsHtml}
                    </div>
                </div>
            </div>
        `
    });
}

