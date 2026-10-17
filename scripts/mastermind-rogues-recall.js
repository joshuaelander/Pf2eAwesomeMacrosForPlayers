/**
 * Mastermind Rogue's Recall
 * 
 * Features:
 * - Validates the Mastermind Racket feature on the actor.
 * - Requires a target (since Mastermind's Assessment targets a specific creature).
 * - Imports and triggers the Enhanced Recall Knowledge macro.
 * - Uses socketlib via the global namespace to bypass player permission restrictions.
 * - Applies an assessment effect to the target and an Ephemeral Off-Guard effect to the rogue.
 * - Handles standard Success (1 round) and Critical Success (1 minute/10 rounds).
 * - Posts a stylized chat card detailing the duration.
 */

import { openRecallKnowledgeDialog } from "./enhanced-recall-knowledge.js";

export const MASTERMIND_RECALL_MACRO_NAME = "Mastermind Rogue's Recall";
export const MASTERMIND_RECALL_MACRO_ICON = "icons/skills/targeting/target-strike-triple-blue.webp";

/**
 * Safely generates a slug matching PF2e's internal sluggify rules
 * (converting camelCase/capitals by inserting hyphens and lowercasing).
 */
function getMastermindSlug(actorId) {
    const raw = `mastermind-off-guard-${actorId}`;
    if (game.pf2e?.system?.sluggify) {
        return game.pf2e.system.sluggify(raw);
    }
    return raw
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Executes strictly on the GM client to bypass player permission blocks.
 */
export async function applyMastermindOffGuardAsGM(targetUuid, durationValue, sourceActorUuid) {
    if (!targetUuid) return;

    const target = await fromUuid(targetUuid);
    if (!target) return;

    const targetActor = target.actor || target;
    if (!targetActor) return;

    const sourceActor = sourceActorUuid ? await fromUuid(sourceActorUuid) : null;
    const sourceActorId = sourceActor?.id ?? "rogue";
    const targetEffectSlug = getMastermindSlug(sourceActorId);

    // Remove existing effect if already present to refresh duration cleanly
    const existing = targetActor.itemTypes.effect.filter(e => e.slug === targetEffectSlug);
    if (existing.length > 0) {
        await targetActor.deleteEmbeddedDocuments("Item", existing.map(e => e.id));
    }

    // Build the effect on the target to tag them as assessed by this rogue
    const effectData = {
        type: "effect",
        name: `Off-Guard to ${sourceActor?.name ?? "Rogue"} (Mastermind)`,
        img: MASTERMIND_RECALL_MACRO_ICON,
        system: {
            slug: targetEffectSlug,
            context: {
                origin: {
                    actor: sourceActorUuid ?? null
                }
            },
            level: { value: 1 },
            duration: {
                value: durationValue,
                unit: "rounds",
                expiry: "turn-start"
            },
            description: {
                value: `<p>This creature is off-guard against attacks from <strong>${sourceActor?.name ?? "the rogue"}</strong> due to Mastermind's Assessment.</p>`
            },
            rules: []
        }
    };

    await targetActor.createEmbeddedDocuments("Item", [effectData]);
}
// --- Main Macro Execution ---
export function mastermindRecall(circumstanceBonus = 0) {
    const controlled = canvas?.tokens?.controlled ?? [];
    let actor = null;
    if (controlled.length > 0) actor = controlled[0].actor;
    else if (!game.user.isGM && game.user.character) actor = game.user.character;

    if (!actor) {
        ui.notifications.warn("Please select your rogue's token first.");
        return;
    }

    // 1. Verify the actor actually has the Mastermind Racket
    const hasMastermind = actor.items.some(i => i.slug === 'mastermind' || i.slug === 'mastermind-racket');
    if (!hasMastermind && !game.user.isGM) {
        ui.notifications.error(`${actor.name} does not possess the Mastermind Racket!`);
        return;
    }

    // 2. Ensure they are targeting a creature
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length === 0) {
        ui.notifications.warn("Mastermind's Assessment requires you to target a creature to observe it.");
        return;
    }
    const target = targets[0];
    const token = actor.getActiveTokens()[0] || null;

    // 3. Set a one-time trap to catch the results from the Enhanced Macro
    Hooks.once('enhancedRecallKnowledgeComplete', async (data) => {
        const { results } = data;

        for (const res of results) {
            // Only process the result belonging to the rogue who initiated this
            if (res.actorId !== actor.id) continue;

            const degree = res.primary.degree;
            if (degree === 'Success' || degree === 'Critical Success') {
                const isCrit = degree === 'Critical Success';
                const durationValue = isCrit ? 10 : 1; // 10 rounds = 1 minute

                const targetUuid = target.actor?.uuid ?? target.document?.uuid;

                // 1. Tag the target creature via GM Socketlib
                if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.applyMastermindOffGuard) {
                    if (targetUuid && actor.uuid) {
                        await game.pf2eAwesomePlayerMacros.applyMastermindOffGuard(targetUuid, durationValue, actor.uuid);
                    }
                } else {
                    ui.notifications.error("Socketlib handler for Mastermind not registered. Make sure the module is active.");
                }

                // 2. Apply Ephemeral Off-Guard rule on the Rogue actor so Sneak Attack & -2 AC trigger strictly for them
                const targetSlug = getMastermindSlug(actor.id);
                const rogueEffectSlug = getMastermindSlug(`assessment-${target.id}`);

                const existingRogueEffects = actor.itemTypes.effect.filter(e => e.slug === rogueEffectSlug);
                if (existingRogueEffects.length > 0) {
                    await actor.deleteEmbeddedDocuments("Item", existingRogueEffects.map(e => e.id));
                }

                const rogueEffectData = {
                    type: "effect",
                    name: `Mastermind's Assessment: ${target.name}`,
                    img: MASTERMIND_RECALL_MACRO_ICON,
                    system: {
                        slug: rogueEffectSlug,
                        level: { value: 1 },
                        duration: {
                            value: durationValue,
                            unit: "rounds",
                            expiry: "turn-start"
                        },
                        description: {
                            value: `<p><strong>${target.name}</strong> is off-guard against your attacks due to Mastermind's Assessment.</p>`
                        },
                        rules: [
                            {
                                key: "EphemeralEffect",
                                selectors: ["strike-attack-roll", "strike-damage", "spell-attack-roll", "spell-damage"],
                                uuid: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg",
                                predicate: [`target:effect:${targetSlug}`]
                            }
                        ]
                    }
                };

                await actor.createEmbeddedDocuments("Item", [rogueEffectData]);

                const timeString = isCrit ? "for 1 minute" : "until the start of your next turn";

                // Generate a persistent chat card instead of a UI notification
                const chatContent = `
                    <div class="pf2e chat-card">
                        <header class="card-header flexrow">
                            <img src="${MASTERMIND_RECALL_MACRO_ICON}" title="Mastermind Rogue's Recall" width="36" height="36" style="border: none; margin-right: 5px;"/>
                            <h3>Mastermind Rogue's Recall</h3>
                        </header>
                        <div class="card-content">
                            <p style="font-size: 0.9em; border-left: 3px solid #18520b; padding-left: 5px; background: rgba(0,0,0,0.05);">
                                <em><strong>Effect:</strong> ${target.name} is now Off-Guard to ${actor.name} ${timeString}.</em>
                            </p>
                        </div>
                    </div>`;

                await ChatMessage.create({
                    user: game.user.id,
                    speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                    content: chatContent
                });
            }
        }
    });

    // 4. Trigger the Enhanced Dialog
    openRecallKnowledgeDialog(circumstanceBonus);
}