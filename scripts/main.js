// Define the name of the folder where the macros will be placed
const MACRO_FOLDER_NAME = "PF2e Awesome Macros For Players";
const MACRO_FOLDER_COLOR = "#990000";

import {
    setupRandomGenAPI,
    createRandomGenMacro,
    handleGMCreateButton
} from "./random-gen.js";

// Ensure this runs only in the PF2e system
Hooks.once("init", () => {
    if (game.system.id !== "pf2e") return;

    // Register the API so macros can call it
    setupRandomGenAPI();
});

// Hook to handle the GM clicking the "Create Actor" button on the chat card
Hooks.on("renderChatMessage", (message, html, data) => {
    // Only execute if the current user is a GM
    if (!game.user.isGM) return;

    // Attach listeners to any GM "Create Actor" buttons in chat
    handleGMCreateButton(message, html, data);
});

Hooks.once('ready', async () => {
    if (game.system.id !== "pf2e") return;

    // Define a global namespace for module functions
    game.pf2eAwesomePlayerMacros = game.pf2eAwesomePlayerMacros || {};

    // Register Global Functions 
    game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog = openRecallKnowledgeDialog;
    game.pf2eAwesomePlayerMacros.createCharacter = createCharacter;

    // Get or Create the Target Folder
    let targetFolderId = null;
    if (game.user.isGM) {
        const folder = await getOrCreateFolder(MACRO_FOLDER_NAME, 'Macro');
        if (folder) {
            targetFolderId = folder.id;
        }

        // Programmatically create the macro buttons 
        createMacroDocument(
            ROLL_RANDOM_CHARACTER_NAME,
            ROLL_RANDOM_CHARACTER_ICON,
            `game.pf2eAwesomePlayerMacros.createCharacter();`,
            targetFolderId
        );

        createMacroDocument(
            ENHANCED_RECALL_MACRO_NAME,
            ENHANCED_RECALL_MACRO_ICON,
            `game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();`,
            targetFolderId
        );
    }

    console.log('PF2e Awesome Macros for Players | All module logic and macros initialized.');
});

// --- Helper Functions --- //

/**
 * Gets an existing folder by name and type, or creates it if it doesn't exist.
 * @param {string} name - The name of the folder.
 * @param {string} type - The document type the folder contains (e.g., 'Macro').
 * @returns {Promise<Folder|null>} The Folder document, or null if creation failed.
 */
async function getOrCreateFolder(name, type) {
    let folder = game.folders.getName(name);

    if (!folder) {
        // Create the folder if it doesn't exist
        try {
            folder = await Folder.create({
                name: name,
                type: type,
                parent: null, // Create at the top level
                color: MACRO_FOLDER_COLOR // <<< Set the folder color here
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
 * Creates a macro document if it doesn't exist, and places it in a specified folder.
 * This ensures GMs don't have to manually import the macro from a compendium.
 * @param {string} name - The name of the macro document.
 * @param {string} icon - The icon path for the macro.
 * @param {string} command - The JavaScript command string (e.g., 'game.namespace.function();').
 * @param {string|null} folderId - The ID of the parent folder, or null for top-level.
 */
async function createMacroDocument(name, icon, command, folderId) {
    // Check for an existing macro with the same name
    const existingMacro = game.macros.getName(name);
    if (existingMacro) {
        return;
    }

    const macroData = {
        name: name,
        type: "script",
        img: icon,
        command: command,
        folder: folderId, // Assign the folder ID here
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        // Add a flag for easy identification/cleanup later if needed
        flags: { "pf2e-awesome-macros-for-players": { isModuleMacro: true } }
    };

    // Only allow GMs to automatically create macro documents
    if (game.user.isGM) {
        try {
            // Create the Macro in the World's macro directory
            await Macro.create(macroData, { renderSheet: false });
            ui.notifications.info(`[PF2e Awesome Macros For Players] Created Macro: ${name}.`);
        } catch (err) {
            console.error(`PF2e Awesome Macros For Players | Failed to create macro: ${name}`, err);
        }
    } else {
        console.warn(`PF2e Awesome Macros For Players | Cannot auto-create macro for non-GM user: ${name}.`);
    }
}