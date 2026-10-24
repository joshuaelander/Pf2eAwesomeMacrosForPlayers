/**
 * PF2e Instructive Strike Macro (Thaumaturge)
 * 
 * Rules (Pathfinder Dark Archive / Remaster):
 * - Make a Strike.
 * - On a hit: You can immediately attempt a check to Recall Knowledge about the target.
 * - On a critical hit: You gain a +2 circumstance bonus to the check to Recall Knowledge.
 * 
 * Macro Features:
 * - Displays active (ready) strikes with dedicated buttons for MAP variants.
 * - Auto-targets player's assigned character if no token is selected.
 * - Rolls the selected strike variant.
 * - Hooks into the attack roll chat message to read the attack outcome.
 * - Waits 3 seconds for 3D dice animations to finish.
 * - On a hit, automatically launches the Enhanced Recall Knowledge dialog.
 * - On a critical hit, passes the +2 circumstance bonus directly to Enhanced Recall Knowledge.
 */

export const INSTRUCTIVE_STRIKE_MACRO_NAME = "Instructive Strike";
export const INSTRUCTIVE_STRIKE_MACRO_ICON = "icons/skills/melee/strike-dagger-arcane-pink.webp";

export async function executeInstructiveStrike() {
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

    if (!actor) {
        return ui.notifications.warn("No valid actor found.");
    }

    // Ensure exactly one target is selected
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        return ui.notifications.warn("Please target exactly one enemy.");
    }

    const target = targets[0];

    // Check for the Instructive Strike feat
    const hasIS = actor.itemTypes.feat.some(f => f.slug === "instructive-strike")
        || actor.items.some(i => i.slug === "instructive-strike" || i.name === "Instructive Strike" || i.name?.toLowerCase().includes("instructive strike"));

    if (!hasIS) {
        if (game.user.isGM) {
            ui.notifications.warn(`${actor.name} does not appear to have Instructive Strike (proceeding as GM).`);
        } else {
            return ui.notifications.info(`${actor.name} does not appear to have Instructive Strike.`);
        }
    }

    // Filter for ready strikes (melee, unarmed, ranged, or thrown)
    const strikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready) ?? [];
    if (strikes.length === 0) {
        return ui.notifications.error("No ready strikes found on this character.");
    }

    // Build the custom UI rows for each strike and its MAP variants
    let contentHtml = `
        <style>
            .is-strike-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding: 6px 10px; background: rgba(0,0,0,0.05); border: 1px solid var(--color-border-light-2, #ccc); border-radius: 4px; }
            .is-strike-name { flex: 1; font-weight: bold; margin-right: 10px; font-size: 1.05em; }
            .is-btn-group { display: flex; gap: 6px; flex-shrink: 0; }
            .is-strike-btn { padding: 6px 10px; line-height: 14px; cursor: pointer; border: 1px solid var(--color-border-dark-4, #999); border-radius: 4px; background: var(--button-background, rgba(255,255,255,0.7)); color: var(--color-text-dark-primary, inherit); min-width: 70px; text-align: center; font-weight: bold; }
            .is-strike-btn:hover { background: rgba(0,0,0,0.15); }
        </style>
        <div style="font-family: 'Signika', sans-serif; margin-bottom: 5px;">
            <div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px;">
                <strong>Target:</strong> ${target.name}
            </div>
            <p style="margin-top: 0; margin-bottom: 12px; font-size: 0.95em;">Select your strike and its Multiple Attack Penalty.</p>
    `;

    strikes.forEach((strike, strikeIdx) => {
        contentHtml += `
            <div class="is-strike-row">
                <span class="is-strike-name" title="${strike.label}">${strike.label}</span>
                <div class="is-btn-group">
                    ${strike.variants.map((variant, variantIdx) => `
                        <button type="button" class="is-strike-btn" data-strike="${strikeIdx}" data-variant="${variantIdx}">${variant.label}</button>
                    `).join('')}
                </div>
            </div>
        `;
    });

    contentHtml += `
            <p style="font-size: 0.85em; color: #555; margin-top: 10px; font-style: italic;">
                On a hit, Recall Knowledge will trigger automatically. On a critical hit, you gain a +2 circumstance bonus to the Recall Knowledge check.
            </p>
        </div>
    `;

    // Create the Dialog reference
    let dialogRef = new Dialog({
        title: "Instructive Strike",
        content: contentHtml,
        buttons: {},
        render: (html) => {
            html.find(".is-strike-btn").click(async (event) => {
                const strikeIdx = event.currentTarget.dataset.strike;
                const variantIdx = event.currentTarget.dataset.variant;
                const chosenStrike = strikes[strikeIdx];

                // Close the dialog immediately upon selection
                dialogRef.close();

                // Set up a one-time hook to catch the result of the strike we are about to roll
                const hookId = Hooks.on("createChatMessage", async (msg) => {
                    // Ensure it's the attack roll from our actor
                    if (msg.actor?.id !== actor.id) return;
                    const context = msg.flags?.pf2e?.context;
                    if (context?.type !== "attack-roll") return;

                    // Clean up the hook immediately
                    Hooks.off("createChatMessage", hookId);

                    // Wait 3 seconds to let 3D dice animations finish before continuing
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const outcome = context.outcome;
                    if (outcome === "success" || outcome === "criticalSuccess") {
                        let bonus = 0;
                        let bonusText = "";

                        if (outcome === "criticalSuccess") {
                            bonus = 2;
                            bonusText = `<br><span style="color:green; font-size:0.9em;"><strong>Instructive Strike:</strong> +2 circumstance bonus applied to Recall Knowledge on a Critical Hit!</span>`;
                        }

                        await ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                            content: `<strong>Instructive Strike Hit!</strong><br>${actor.name} hit ${target.name} and is attempting to Recall Knowledge.${bonusText}`
                        });

                        // Pass the calculated bonus directly into the Enhanced Recall Knowledge dialog
                        if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
                            game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog(bonus);
                        } else {
                            ui.notifications.error("Enhanced Recall Knowledge logic not found. Make sure the module is active.");
                        }

                    } else {
                        await ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                            content: `<strong>Instructive Strike Missed!</strong><br>${actor.name} failed to hit ${target.name}. No Recall Knowledge check is triggered.`
                        });
                    }
                });

                // Fire the exact MAP variant strike chosen
                await chosenStrike.variants[variantIdx].roll({ event });

                // Safety timeout: Remove the hook after 10 seconds just in case the roll is cancelled or fails
                setTimeout(() => {
                    Hooks.off("createChatMessage", hookId);
                }, 10000);
            });
        }
    });

    // Render the dialog
    dialogRef.render(true);
}
