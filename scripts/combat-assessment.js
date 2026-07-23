/**
 * PF2e Combat Assessment Macro
 * * Prompts the user to select a melee strike.
 * * Rolls the selected strike.
 * * Hooks into the chat message to read the attack's outcome.
 * * On a hit/crit, applies Observational Analysis bonuses (if applicable) and launches Enhanced RK.
 */

export const COMBAT_ASSESSMENT_MACRO_NAME = "Combat Assessment";
export const COMBAT_ASSESSMENT_MACRO_ICON = "icons/skills/melee/strike-sword-blood-red.webp";

export async function executeCombatAssessment() {
    // Ensure exactly one token is selected
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length !== 1) {
        return ui.notifications.warn("Please select exactly one of your tokens.");
    }

    // Ensure exactly one target is selected
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        return ui.notifications.warn("Please target exactly one enemy.");
    }

    const token = controlled[0];
    const actor = token.actor;
    const target = targets[0];

    // Check for the relevant feats
    const hasCA = actor.itemTypes.feat.some(f => f.slug === "combat-assessment") || actor.items.some(i => i.slug === "combat-assessment" || i.name === "Combat Assessment");
    const hasOA = actor.itemTypes.feat.some(f => f.slug === "observational-analysis") || actor.items.some(i => i.slug === "observational-analysis" || i.name === "Observational Analysis");

    if (!hasCA && !hasOA) {
        ui.notifications.info(`${actor.name} does not appear to have Combat Assessment or Observational Analysis, but proceeding anyway.`);
    }

    // Filter for only Melee Strikes (Combat Assessment requires a melee Strike)
    const meleeStrikes = actor.system.actions.filter(a => a.type === "strike" && a.item.isMelee);
    if (meleeStrikes.length === 0) {
        return ui.notifications.error("No melee strikes found on this character.");
    }

    // Build the weapon selection dropdown
    const optionsHtml = meleeStrikes.map((s, idx) => `<option value="${idx}">${s.label}</option>`).join("");

    new Dialog({
        title: "Combat Assessment",
        content: `
            <form style="margin-bottom: 10px;">
                <div class="form-group">
                    <label style="font-weight: bold;">Select Attack:</label>
                    <select id="strike-select" style="width: 100%; padding: 4px;">${optionsHtml}</select>
                </div>
            </form>
            <p style="font-size: 0.9em; color: #555;"><em>This will roll your attack. If it hits, it will automatically trigger your Recall Knowledge check.</em></p>
        `,
        buttons: {
            roll: {
                icon: '<i class="fas fa-dice-d20"></i>',
                label: "Strike!",
                callback: async (html) => {
                    const selectedIdx = parseInt(html.find("#strike-select").val());
                    const chosenStrike = meleeStrikes[selectedIdx];

                    // Set up a one-time hook to catch the result of the strike we are about to roll
                    const hookId = Hooks.on("createChatMessage", async (msg) => {
                        // Ensure it's the attack roll from our actor
                        if (msg.actor?.id !== actor.id) return;
                        const context = msg.flags?.pf2e?.context;
                        if (context?.type !== "attack-roll") return;

                        // Clean up the hook immediately so it doesn't fire on future attacks
                        Hooks.off("createChatMessage", hookId);

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
                                speaker: ChatMessage.getSpeaker({ token: token }),
                                content: `<strong>Combat Assessment Hit!</strong><br>${actor.name} hit ${target.name} and immediately attempts to Recall Knowledge.${bonusText}`
                            });

                            // Pass the calculated bonus directly into the RK dialog!
                            if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
                                game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog(bonus);
                            }

                        } else {
                            await ChatMessage.create({
                                user: game.user.id,
                                speaker: ChatMessage.getSpeaker({ token: token }),
                                content: `<strong>Combat Assessment Missed!</strong><br>${actor.name} failed to hit ${target.name}. No Recall Knowledge check is triggered.`
                            });
                        }
                    });

                    // Fire the strike to trigger the hook above
                    await chosenStrike.variants[0].roll();

                    // Safety timeout: Remove the hook after 10 seconds just in case the roll is cancelled
                    setTimeout(() => {
                        Hooks.off("createChatMessage", hookId);
                    }, 10000);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "roll"
    }).render(true);
}