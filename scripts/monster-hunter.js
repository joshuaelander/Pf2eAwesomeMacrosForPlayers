/**
 * PF2e Monster Hunter Macro
 * * Verifies a token and target are selected.
 * * Posts the Hunt Prey action to chat.
 * * Applies "Effect: Hunt Prey" to the Ranger.
 * * Automatically launches the Enhanced Recall Knowledge dialog.
 */

export const MONSTER_HUNTER_MACRO_NAME = "Monster Hunter";
export const MONSTER_HUNTER_MACRO_ICON = "icons/magic/nature/stealth-hide-eyes-green.webp";

export async function executeMonsterHunter() {
    // Ensure exactly one token is selected (Safely chained for tablet UI)
    const controlled = canvas?.tokens?.controlled ?? [];
    if (controlled.length !== 1) {
        ui.notifications.warn("Please select your token.");
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

    // --- 1. Post Hunt Prey to chat ---
    const huntPrey = actor.itemTypes.action.find(a => a.slug === "hunt-prey")
        || actor.itemTypes.feat.find(f => f.slug === "hunt-prey");

    if (huntPrey) {
        await huntPrey.toMessage();
    } else {
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ token: token }),
            content: `<strong>${actor.name}</strong> uses @UUID[Compendium.pf2e.actionspf2e.Item.Jyi4gnsAxsE5KxL1]{Hunt Prey} on <strong>${target.name}</strong>!`
        });
    }

    // --- 2. Find and Apply "Effect: Hunt Prey" ---
    const effectName = "Effect: Hunt Prey";
    let effectData = null;

    // Look in world items first 
    let worldEffect = game.items.find(i => i.name === effectName && i.type === "effect");
    if (worldEffect) {
        effectData = worldEffect.toObject();
    } else {
        // Modern PF2e UUID direct fetch (Faster than indexing)
        const effectDoc = await fromUuid("Compendium.pf2e.feat-effects.Item.uX5hQZ3yE45u5Lmw");
        if (effectDoc) {
            effectData = effectDoc.toObject();
        } else {
            // Failsafe: Index search if UUID changes in a future system update
            const pack = game.packs.get("pf2e.feat-effects");
            if (pack) {
                const index = await pack.getIndex();
                const entry = index.find(e => e.name === effectName);
                if (entry) {
                    const compendiumEffect = await pack.getDocument(entry._id);
                    effectData = compendiumEffect.toObject();
                }
            }
        }
    }

    if (effectData) {
        // Prevent duplicate effects
        const hasEffect = actor.itemTypes.effect.some(e => e.name === effectName);
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

    // --- 3. Trigger Enhanced Recall Knowledge ---
    // Direct link to your custom module logic!
    if (game.pf2eAwesomePlayerMacros && game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog) {
        game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();
    } else {
        ui.notifications.error("Enhanced Recall Knowledge logic not found. Make sure the module is active.");
    }
}