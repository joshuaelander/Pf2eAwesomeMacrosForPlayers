/**
 * Mastermind Rogue's Recall
 * 
 * Features:
 * - Validates the Mastermind Racket feature on the actor.
 * - Requires a target (since Mastermind's Assessment targets a specific creature).
 * - Imports and triggers the Enhanced Recall Knowledge macro.
 * - Uses socketlib via the global namespace to bypass player permission restrictions.
 * - Applies a custom wrapper effect containing a GrantItem rule for Off-Guard.
 * - Handles standard Success (1 round) and Critical Success (1 minute/10 rounds).
 * - Posts a stylized chat card detailing the duration.
 */

import { openRecallKnowledgeDialog } from "./enhanced-recall-knowledge.js";

export const MASTERMIND_RECALL_MACRO_NAME = "Mastermind Rogue's Recall";
export const MASTERMIND_RECALL_MACRO_ICON = "icons/skills/targeting/target-strike-triple-blue.webp";

/**
 * Executes strictly on the GM client to bypass player permission blocks.
 */
export async function applyMastermindOffGuardAsGM(targetUuid, durationValue) {
    const target = await fromUuid(targetUuid);
    if (!target) return;

    // Support either a TokenDocument or an Actor document
    const targetActor = target.actor || target;
    if (!targetActor) return;

    // Build the custom wrapper effect with a GrantItem rule element
    const effectData = {
        type: "effect",
        name: "Mastermind's Assessment",
        img: MASTERMIND_RECALL_MACRO_ICON,
        system: {
            level: { value: 1 },
            duration: {
                value: durationValue,
                unit: "rounds",
                expiry: "turn-start"
            },
            description: {
                value: "<p>This creature is off-guard due to Mastermind's Assessment.</p>"
            },
            rules: [
                {
                    // Grants the built-in PF2e Off-Guard condition natively
                    key: "GrantItem",
                    uuid: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg"
                }
            ]
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

                // Check for the global socketlib handler
                if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.applyMastermindOffGuard) {
                    await game.pf2eAwesomePlayerMacros.applyMastermindOffGuard(target.actor.uuid, durationValue);

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
                                    <em><strong>Effect:</strong> ${target.name} is now Off-Guard ${timeString}.</em>
                                </p>
                            </div>
                        </div>`;

                    await ChatMessage.create({
                        user: game.user.id,
                        speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                        content: chatContent
                    });

                } else {
                    ui.notifications.error("Socketlib handler for Mastermind not registered. Make sure the module is active.");
                }
            }
        }
    });

    // 4. Trigger the Enhanced Dialog
    openRecallKnowledgeDialog(circumstanceBonus);
}