// Define the name of the folder where the macros will be placed
const MODULE_ID = "pf2e-awesome-macros-for-players";
const MACRO_FOLDER_NAME = "PF2e Awesome Macros For Players";
const MACRO_FOLDER_COLOR = "#990000";

import {
    handleGMCreateButton,
    createCharacter,
    ROLL_RANDOM_CHARACTER_MACRO_NAME,
    ROLL_RANDOM_CHARACTER_MACRO_ICON,
} from "./roll-random-character.js";

import {
    openRecallKnowledgeDialog,
    ENHANCED_RECALL_MACRO_NAME,
    ENHANCED_RECALL_MACRO_ICON,
} from "./enhanced-recall-knowledge.js";

import {
    addExplorationActivity,
    EXPLORATION_ACTIVITY_MACRO_NAME,
    EXPLORATION_ACTIVITY_MACRO_ICON,
} from "./easy-exploration.js";

// --- THE DESIRED MACRO STATE ---
// Add any new macros to this array. The Smart Sync will handle the rest!
const DESIRED_MACROS = [
    { name: ROLL_RANDOM_CHARACTER_MACRO_NAME, icon: ROLL_RANDOM_CHARACTER_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.createCharacter();` },
    { name: ENHANCED_RECALL_MACRO_NAME, icon: ENHANCED_RECALL_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();` },
    { name: EXPLORATION_ACTIVITY_MACRO_NAME, icon: EXPLORATION_ACTIVITY_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.addExplorationActivity();` }
];

// Hook to handle the GM clicking the "Create Actor" button on the chat card
Hooks.on("renderChatMessage", (message, html, data) => {
    // Only execute if the current user is a GM
    if (!game.user.isGM) return;

    // Attach listeners to any GM "Create Actor" buttons in chat
    handleGMCreateButton(message, html, data);
});

// --- HELPER FUNCTIONS --- //

/**
 * Gets an existing folder by name and type, or creates it if it doesn't exist.
 */
async function getOrCreateFolder(name, type) {
    let folder = game.folders.getName(name);

    if (!folder) {
        try {
            folder = await Folder.create({
                name: name,
                type: type,
                parent: null,
                color: MACRO_FOLDER_COLOR
            });
            ui.notifications.info(`[PF2e Awesome Macros For Players] Created folder: ${name}.`);
        } catch (err) {
            console.error(`PF2e Awesome Macros For Players | Failed to create folder: ${name}`, err);
            return null;
        }
    }
    return folder;
}

/**
 * Compares the existing macros in the world to the DESIRED_MACROS list.
 * Creates missing macros, updates existing ones, and deletes obsolete ones.
 */
async function syncMacros() {
    const folder = await getOrCreateFolder(MACRO_FOLDER_NAME, 'Macro');
    if (!folder) return;

    // Find all macros currently in the world that belong to this module
    const existingMacros = game.macros.filter(m => m.flags?.[MODULE_ID]?.isModuleMacro);
    const desiredNames = DESIRED_MACROS.map(m => m.name);

    // Set ownership so players can actually use them
    const observerOwnership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };

    // 1. Delete Obsolete Macros (Exists in world, but no longer in DESIRED_MACROS)
    const obsoleteIds = existingMacros.filter(m => !desiredNames.includes(m.name)).map(m => m.id);
    if (obsoleteIds.length > 0) {
        await Macro.deleteDocuments(obsoleteIds);
        console.log(`PF2e Awesome Macros For Players | Deleted ${obsoleteIds.length} obsolete macros.`);
    }

    // 2. Create or Update Macros
    let createdCount = 0;
    let updatedCount = 0;

    for (const desired of DESIRED_MACROS) {
        const existing = existingMacros.find(m => m.name === desired.name);

        if (existing) {
            // Check if command, icon, folder, OR ownership permissions are out of sync
            if (existing.command !== desired.command ||
                existing.img !== desired.icon ||
                existing.folder?.id !== folder.id ||
                existing.ownership.default !== observerOwnership.default) {

                await existing.update({
                    command: desired.command,
                    img: desired.icon,
                    folder: folder.id,
                    ownership: observerOwnership
                });
                updatedCount++;
            }
        } else {
            // Create from scratch with Observer permissions
            const macroData = {
                name: desired.name,
                type: "script",
                img: desired.icon,
                command: desired.command,
                folder: folder.id,
                ownership: observerOwnership,
                flags: { [MODULE_ID]: { isModuleMacro: true } }
            };
            await Macro.create(macroData, { renderSheet: false });
            createdCount++;
        }
    }

    if (createdCount > 0 || updatedCount > 0) {
        ui.notifications.info(`[PF2e Awesome Macros For Players] Sync complete! Created: ${createdCount}, Updated: ${updatedCount}.`);
    }
}

// --- INITIALIZATION --- //

Hooks.once('ready', async () => {
    if (game.system.id !== "pf2e") return;

    // Define a global namespace for module functions
    game.pf2eAwesomePlayerMacros = game.pf2eAwesomePlayerMacros || {};

    // Register Global Functions 
    game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog = openRecallKnowledgeDialog;
    game.pf2eAwesomePlayerMacros.createCharacter = createCharacter;
    game.pf2eAwesomePlayerMacros.addExplorationActivity = addExplorationActivity;

    if (game.user.isGM) {
        const currentVersion = game.modules.get(MODULE_ID)?.version || "1.0.0";
        let folder = game.folders.getName(MACRO_FOLDER_NAME);
        const storedVersion = folder ? folder.getFlag(MODULE_ID, "moduleVersion") : null;

        // Run the Smart Sync if the version has changed
        if (currentVersion !== storedVersion) {
            await syncMacros();

            // Re-fetch the folder just in case it was created during the sync
            folder = game.folders.getName(MACRO_FOLDER_NAME);
            if (folder) {
                await folder.setFlag(MODULE_ID, "moduleVersion", currentVersion);
            }
        }
    }

    console.log('PF2e Awesome Macros for Players | All module logic and macros initialized.');
});