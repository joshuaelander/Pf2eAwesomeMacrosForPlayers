/**
 * PF2e Combat Assessment Macro
 * * Displays active (ready) melee strikes with dedicated, aligned buttons for MAP variants.
 * * Auto-targets the player's assigned character if no token is selected.
 * * Rolls the selected strike variant.
 * * Hooks into the chat message to read the attack's outcome.
 * * Waits 3 seconds for 3D dice animations to finish.
 * * On a hit/crit, applies Observational Analysis bonuses (if applicable) and launches Enhanced RK.
 */

export const COMBAT_ASSESSMENT_MACRO_NAME = "Combat Assessment";
export const COMBAT_ASSESSMENT_MACRO_ICON = "icons/skills/melee/strike-sword-blood-red.webp";

export async function executeCombatAssessment() {
    // Ensure a token/actor is selected, or default to the player's assigned character
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        // Grab the active token for this character on the current scene
        token = actor.getActiveTokens()[0] ?? null;
    } else {
        return ui.notifications.warn("Please select exactly one of your tokens.");
    }

    // Ensure exactly one target is selected
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        return ui.notifications.warn("Please target exactly one enemy.");
    }

    const target = targets[0];

    // Check for the relevant feats
    const hasCA = actor.itemTypes.feat.some(f => f.slug === "combat-assessment") || actor.items.some(i => i.slug === "combat-assessment" || i.name === "Combat Assessment");
    const hasOA = actor.itemTypes.feat.some(f => f.slug === "observational-analysis") || actor.items.some(i => i.slug === "observational-analysis" || i.name === "Observational Analysis");

    if (!hasCA && !hasOA) {
        return ui.notifications.info(`${actor.name} does not appear to have Combat Assessment.`);
    }

    // Filter for only Melee Strikes that are actually drawn/ready (excludes stowed weapons)
    const meleeStrikes = actor.system.actions.filter(a => a.type === "strike" && a.item.isMelee && a.ready);
    if (meleeStrikes.length === 0) {
        return ui.notifications.error("No ready melee strikes found on this character.");
    }

    // Build the custom UI rows for each weapon and its MAP variants
    let contentHtml = `
        <style>
            .ca-strike-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding: 6px; background: rgba(0,0,0,0.05); border: 1px solid var(--color-border-light-2); border-radius: 4px; }
            .ca-strike-name { flex: 1; font-weight: bold; width: 68px; margin-right: 10px; white-space: wrap; font-size: 1.05em; }
            .ca-btn-group { display: flex; gap: 6px; flex-shrink: 0; }
            .ca-strike-btn { padding: 6px 0; line-height: 14px; cursor: pointer; border: 1px solid var(--color-border-dark-4); border-radius: 4px; background: rgba(255,255,255,0.7); width: 88px; text-align: center; font-weight: bold; }
            .ca-strike-btn:hover { background: rgba(0,0,0,0.1); }
        </style>
        <div style="font-family: 'Signika', sans-serif; margin-bottom: 5px;">
            <p style="margin-top: 0; margin-bottom: 12px; font-size: 0.95em;">Select your melee strike and its Multiple Attack Penalty.</p>
    `;

    meleeStrikes.forEach((strike, strikeIdx) => {
        contentHtml += `
            <div class="ca-strike-row">
                <span class="ca-strike-name" title="${strike.label}">${strike.label}</span>
                <div class="ca-btn-group">
                    ${strike.variants.map((variant, variantIdx) => `
                        <button type="button" class="ca-strike-btn" data-strike="${strikeIdx}" data-variant="${variantIdx}">${variant.label}</button>
                    `).join('')}
                </div>
            </div>
        `;
    });

    contentHtml += `
            <p style="font-size: 0.85em; color: #555; margin-top: 10px; font-style: italic;">On a hit, Recall Knowledge will trigger automatically.</p>
        </div>
    `;

    // Create the Dialog reference
    let dialogRef = new Dialog({
        title: "Combat Assessment",
        content: contentHtml,
        buttons: {},
        render: (html) => {
            // Attach click listeners to all the dynamically generated MAP buttons
            html.find(".ca-strike-btn").click(async (event) => {
                const strikeIdx = event.currentTarget.dataset.strike;
                const variantIdx = event.currentTarget.dataset.variant;
                const chosenStrike = meleeStrikes[strikeIdx];

                // Close the dialog immediately upon selection
                dialogRef.close();

                // Set up a one-time hook to catch the result of the strike we are about to roll
                const hookId = Hooks.on("createChatMessage", async (msg) => {
                    // Ensure it's the attack roll from our actor
                    if (msg.actor?.id !== actor.id) return;
                    const context = msg.flags?.pf2e?.context;
                    if (context?.type !== "attack-roll") return;

                    // Clean up the hook immediately so it doesn't fire on future attacks
                    Hooks.off("createChatMessage", hookId);

                    // Wait 3 seconds to let 3D dice animations finish before continuing
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const outcome = context.outcome;
                    if (outcome === "success" || outcome === "criticalSuccess") {
                        let bonus = 0;
                        let bonusText = "";

                        if (hasOA) {
                            bonus = outcome === "criticalSuccess" ? 4 : 2;
                            bonusText = `<br><span style="color:green; font-size:0.9em;"><strong>Observational Analysis:</strong> +${bonus} circumstance bonus applied to RK!</span>`;
                        }

                        await ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                            content: `<strong>Combat Assessment Hit!</strong><br>${actor.name} hit ${target.name} and is attempting to Recall Knowledge.${bonusText}`
                        });

                        // Pass the calculated bonus directly into the RK dialog!
                        if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
                            game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog(bonus);
                        }

                    } else {
                        await ChatMessage.create({
                            user: game.user.id,
                            speaker: ChatMessage.getSpeaker({ actor: actor, token: token }),
                            content: `<strong>Combat Assessment Missed!</strong><br>${actor.name} failed to hit ${target.name}. No Recall Knowledge check is triggered.`
                        });
                    }
                });

                // Fire the exact MAP variant strike chosen (passing the click event for blind/secret roll modifiers)
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