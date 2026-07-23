/**
 * PF2e Known Weaknesses Macro (Investigator)
 * * Verifies a token and target are selected.
 * * Posts Devise a Stratagem action to chat.
 * * Applies "Effect: Devise a Stratagem" to the Investigator (rolling d20 & applying roll substitution).
 * * Checks if the Investigator has the "Known Weaknesses" feat before launching Enhanced Recall Knowledge.
 */

export const KNOWN_WEAKNESSES_MACRO_NAME = "Known Weaknesses (Devise a Stratagem)";
export const KNOWN_WEAKNESSES_MACRO_ICON = "icons/skills/targeting/crosshair-arrowhead-blue.webp";

export async function executeKnownWeaknesses() {
    // Ensure exactly one token is selected
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length !== 1) {
        ui.notifications.warn("Please select exactly one of your tokens.");
        return;
    }

    // Ensure exactly one target is selected
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length !== 1) {
        ui.notifications.warn("Please target exactly one enemy.");
        return;
    }

    const token = controlled[0];
    const actor = token.actor;
    const target = targets[0];

    // --- 1. Find and Post Devise a Stratagem Action to Chat ---
    const deviseAction = actor.itemTypes.action.find(a => a.slug === "devise-a-stratagem")
        || actor.items.find(i => i.type === "action" && (i.slug === "devise-a-stratagem" || i.name === "Devise a Stratagem"))
        || actor.itemTypes.feat.find(f => f.slug === "devise-a-stratagem");

    if (deviseAction) {
        await deviseAction.toMessage();
    } else {
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: `<strong>${actor.name}</strong> uses @UUID[Compendium.pf2e.actionspf2e.Item.m0f2B7G9eaaTmhFL]{Devise a Stratagem} against <strong>${target.name}</strong>!`
        });
    }

    // --- 2. Find and Apply "Effect: Devise a Stratagem" ---
    const effectName = "Effect: Devise a Stratagem";
    const effectSlug = "effect-devise-a-stratagem";
    let effectData = null;

    // Look in world items first
    let worldEffect = game.items.find(i => (i.slug === effectSlug || i.name === effectName) && i.type === "effect");
    if (worldEffect) {
        effectData = worldEffect.toObject();
    } else {
        // Modern PF2e UUID direct fetch
        const effectDoc = await fromUuid("Compendium.pf2e.feat-effects.Item.XQpTyjXFYYNexyOk");
        if (effectDoc) {
            effectData = effectDoc.toObject();
        } else {
            // Failsafe: Index search if UUID changes in a future system update
            const pack = game.packs.get("pf2e.feat-effects");
            if (pack) {
                const index = await pack.getIndex();
                const entry = index.find(e => e.slug === effectSlug || e.name === effectName);
                if (entry) {
                    const compendiumEffect = await pack.getDocument(entry._id);
                    effectData = compendiumEffect.toObject();
                }
            }
        }
    }

    if (effectData) {
        // Prevent duplicate effects
        const hasEffect = actor.itemTypes.effect.some(e => e.slug === effectSlug || e.name === effectName);
        if (!hasEffect) {
            effectData.system.duration.value = effectData.system.duration.value || 1;
            await actor.createEmbeddedDocuments("Item", [effectData]);
            ui.notifications.info(`Applied ${effectName} to ${actor.name}.`);
        } else {
            ui.notifications.info(`${actor.name} already has ${effectName} applied.`);
        }
    } else {
        ui.notifications.warn(`Could not find "${effectName}" in the compendiums.`);
    }

    // --- 3. Check for Known Weaknesses Feat & Trigger Enhanced Recall Knowledge ---
    const hasKnownWeaknesses = actor.itemTypes.feat.some(f => f.slug === "known-weaknesses")
        || actor.items.some(i => i.slug === "known-weaknesses" || i.name === "Known Weaknesses");

    if (hasKnownWeaknesses) {
        if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
            game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();
        } else {
            ui.notifications.error("Enhanced Recall Knowledge logic not found. Make sure the module is active.");
        }
    } else {
        ui.notifications.info(`${actor.name} does not have the Known Weaknesses feat. Skipping Recall Knowledge.`);
    }
}