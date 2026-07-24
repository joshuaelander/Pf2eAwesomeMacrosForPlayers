/**
 * PF2e Magus's Analysis Macro
 * * Auto-targets the player's assigned character if no token is selected.
 * * Prompts the player to confirm if they hit the target this turn for the +1 bonus.
 * * Launches Enhanced Recall Knowledge with the appropriate bonus.
 * * Uses Socketlib to apply a generic 1-day immunity effect directly to the target.
 * * Posts a chat card announcing the Spellstrike recharge.
 */

export const MAGUS_ANALYSIS_MACRO_NAME = "Magus's Analysis";
export const MAGUS_ANALYSIS_MACRO_ICON = "icons/magic/symbols/cog-shield-white-blue.webp";

export async function executeMagusAnalysis() {
    // Ensure a token/actor is selected, or default to the player's assigned character
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
        return ui.notifications.warn("Please select exactly one of your tokens.");
    }

    // Ensure exactly one target is selected
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        return ui.notifications.warn("Please target exactly one enemy.");
    }

    const targetToken = targets[0];
    const targetActor = targetToken.actor;

    if (!targetActor) {
        return ui.notifications.error("Target has no valid actor.");
    }

    // Check for the Magus's Analysis feat
    const hasFeat = actor.itemTypes.feat.some(f => f.slug === "maguss-analysis" || f.slug === "magus-analysis")
        || actor.items.some(i => i.slug === "maguss-analysis" || i.slug === "magus-analysis" || i.name.includes("Magus's Analysis"));

    if (!hasFeat) {
        return ui.notifications.info(`${actor.name} does not appear to have Magus's Analysis.`);
    }

    // --- 1. Find and Post Magus's Analysis Action to Chat ---
    const analysisAction = actor.itemTypes.action.find(a => a.slug === "maguss-analysis" || a.slug === "magus-analysis")
        || actor.items.find(i => i.type === "action" && (i.slug === "maguss-analysis" || i.slug === "magus-analysis" || i.name.includes("Magus's Analysis")))
        || actor.itemTypes.feat.find(f => f.slug === "maguss-analysis" || f.slug === "magus-analysis");

    if (analysisAction) {
        await analysisAction.toMessage();
    } else {
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
            content: `<strong>${actor.name}</strong> uses Magus's Analysis against the target!`
        });
    }

    // --- 2. Prompt for the Conditional +1 Bonus ---
    new Dialog({
        title: "Magus's Analysis",
        content: `
            <div style="font-family: 'Signika', sans-serif; margin-bottom: 10px;">
                <p style="margin-top: 0;">Did you previously hit this target with a Strike this turn?</p>
                <p style="font-size: 0.85em; color: #555; margin-bottom: 0;"><em>(If yes, you gain a +1 circumstance bonus to your Recall Knowledge check.)</em></p>
            </div>
        `,
        buttons: {
            yes: {
                icon: '<i class="fas fa-check"></i>',
                label: "Yes (+1)",
                callback: async () => {
                    await finishMagusAnalysis(actor, targetActor, targetToken, token, 1);
                }
            },
            no: {
                icon: '<i class="fas fa-times"></i>',
                label: "No (+0)",
                callback: async () => {
                    await finishMagusAnalysis(actor, targetActor, targetToken, token, 0);
                }
            }
        },
        default: "yes"
    }).render(true);
}

/**
 * Handles the final outputs after the user selects their bonus condition.
 */
async function finishMagusAnalysis(actor, targetActor, targetToken, token, bonus) {
    // --- 3. Apply Immunity to Target via Socketlib ---
    if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.applyMagusImmunity) {
        const result = await game.pf2eAwesomePlayerMacros.applyMagusImmunity(targetActor);
        if (result === "already_immune") {
            ui.notifications.warn(`${targetToken.name} is already immune to Magus's Analysis.`);
            return;
        } else if (!result || result.success === false) {
            ui.notifications.error("Failed to apply immunity effect to the target.");
            return;
        }
    } else {
        ui.notifications.error("Socketlib handler for Magus immunity not registered.");
        return;
    }

    // --- 4. Trigger Enhanced Recall Knowledge ---
    if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
        game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog(bonus);
    } else {
        ui.notifications.error("Enhanced Recall Knowledge logic not found. Make sure the module is active.");
    }

    // --- 5. Post Recharge Reminder Card ---
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <h3>Spellstrike Recharged</h3>
                </header>
                <div class="card-content">
                    <p><strong>${actor.name}</strong> instantly recharges their Spellstrike!</p>
                    <p style="font-size: 0.9em; border-left: 3px solid #18520b; padding-left: 5px; background: rgba(0,0,0,0.05);">
                        <em><strong>Note:</strong> ${targetToken.name} is now temporarily immune to Magus's Analysis for 1 day.</em>
                    </p>
                </div>
            </div>`
    });
}