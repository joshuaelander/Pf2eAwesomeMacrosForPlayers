/**
 * PF2e Monster Hunter Macro
 * - Runs the shared Hunt Prey macro (posts built-in Hunt Prey, applies "Effect: Hunt Prey",
 *   and places the Hunted Prey visual indicator on the targeted enemy).
 * - Automatically launches the Enhanced Recall Knowledge dialog.
 */

import { executeHuntPrey } from "../combat/hunt-prey.js";

export const MONSTER_HUNTER_MACRO_NAME = "Monster Hunter";
export const MONSTER_HUNTER_MACRO_ICON = "icons/magic/nature/stealth-hide-eyes-green.webp";

export async function executeMonsterHunter() {
    const runHuntPrey = game.pf2eAwesomePlayerMacros?.executeHuntPrey ?? executeHuntPrey;
    const huntResult = await runHuntPrey();
    if (!huntResult?.success) return;

    // Trigger Enhanced Recall Knowledge
    if (game.pf2eAwesomePlayerMacros?.openRecallKnowledgeDialog) {
        game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();
    } else {
        ui.notifications.error("Enhanced Recall Knowledge logic not found. Make sure the module is active.");
    }
}
