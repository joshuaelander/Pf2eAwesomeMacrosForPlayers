// Define the name of the folder where the macros will be placed
const MODULE_ID = "pf2e-awesome-macros-for-players";
const MACRO_FOLDER_NAME = "PF2e Awesome Macros For Players";
const MACRO_FOLDER_COLOR = "#990000";

import {
    handlePlayerCreateButton,
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

import {
    executeMonsterHunter,
    MONSTER_HUNTER_MACRO_NAME,
    MONSTER_HUNTER_MACRO_ICON,
} from "./monster-hunter.js";

import {
    executeKnownWeaknesses,
    KNOWN_WEAKNESSES_MACRO_NAME,
    KNOWN_WEAKNESSES_MACRO_ICON,
} from "./known-weaknesses.js";

import {
    executeCombatAssessment,
    COMBAT_ASSESSMENT_MACRO_NAME,
    COMBAT_ASSESSMENT_MACRO_ICON,
} from "./combat-assessment.js";

import {
    executeMagusAnalysis,
    MAGUS_ANALYSIS_MACRO_NAME,
    MAGUS_ANALYSIS_MACRO_ICON,
} from "./magus-analysis.js";

// --- THE DESIRED MACRO STATE ---
const DESIRED_MACROS = [
    { name: ROLL_RANDOM_CHARACTER_MACRO_NAME, icon: ROLL_RANDOM_CHARACTER_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.createCharacter();` },
    { name: ENHANCED_RECALL_MACRO_NAME, icon: ENHANCED_RECALL_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();` },
    { name: EXPLORATION_ACTIVITY_MACRO_NAME, icon: EXPLORATION_ACTIVITY_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.addExplorationActivity();` },
    { name: MONSTER_HUNTER_MACRO_NAME, icon: MONSTER_HUNTER_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeMonsterHunter();` },
    { name: KNOWN_WEAKNESSES_MACRO_NAME, icon: KNOWN_WEAKNESSES_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeKnownWeaknesses();` },
    { name: COMBAT_ASSESSMENT_MACRO_NAME, icon: COMBAT_ASSESSMENT_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeCombatAssessment();` },
    { name: MAGUS_ANALYSIS_MACRO_NAME, icon: MAGUS_ANALYSIS_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeMagusAnalysis();` }
];

// Hook to handle the "Create Actor" button on the chat card for players
Hooks.on("renderChatMessage", (message, html, data) => {
    handlePlayerCreateButton(message, html, data);
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

    const existingMacros = game.macros.filter(m => m.flags?.[MODULE_ID]?.isModuleMacro);
    const desiredNames = DESIRED_MACROS.map(m => m.name);
    const observerOwnership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };

    const obsoleteIds = existingMacros.filter(m => !desiredNames.includes(m.name)).map(m => m.id);
    if (obsoleteIds.length > 0) {
        await Macro.deleteDocuments(obsoleteIds);
        console.log(`PF2e Awesome Macros For Players | Deleted ${obsoleteIds.length} obsolete macros.`);
    }

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

// Global variable for our socket
let playerModuleSocket;

// --- MAIN INITIALIZATION --- //
Hooks.once('ready', async () => {
    if (game.system.id !== "pf2e") return;

    // Define a global namespace for module functions
    game.pf2eAwesomePlayerMacros = game.pf2eAwesomePlayerMacros || {};

    // Register Global Functions 
    game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog = openRecallKnowledgeDialog;
    game.pf2eAwesomePlayerMacros.createCharacter = createCharacter;
    game.pf2eAwesomePlayerMacros.addExplorationActivity = addExplorationActivity;
    game.pf2eAwesomePlayerMacros.executeMonsterHunter = executeMonsterHunter;
    game.pf2eAwesomePlayerMacros.executeKnownWeaknesses = executeKnownWeaknesses;
    game.pf2eAwesomePlayerMacros.executeCombatAssessment = executeCombatAssessment;
    game.pf2eAwesomePlayerMacros.executeMagusAnalysis = executeMagusAnalysis;

    // --- SOCKETLIB SETUP --- //
    if (game.modules.get("socketlib")?.active) {
        playerModuleSocket = socketlib.registerModule(MODULE_ID);

        // 1. Magus Analysis Socket
        playerModuleSocket.register("applyMagusImmunity", async (targetActorUuid) => {
            if (!game.user.isGM) return { success: false };

            const targetActor = await fromUuid(targetActorUuid);
            if (!targetActor) return { success: false };

            const effectName = "Magus's Analysis Immunity";
            const hasImmunity = targetActor.itemTypes.effect.some(e => e.name === effectName);
            if (hasImmunity) return "already_immune";

            const effectData = {
                type: "effect",
                name: effectName,
                img: "icons/magic/symbols/cog-shield-white-blue.webp",
                system: {
                    level: { value: targetActor.system.details?.level?.value || 1 },
                    duration: { value: 1, unit: "days", expiry: "turn-start" },
                    description: { value: `<p>This creature is temporarily immune to Magus's Analysis.</p>` }
                }
            };

            await targetActor.createEmbeddedDocuments("Item", [effectData]);
            return { success: true };
        });

        // 2. Player Actor Creation Socket
        playerModuleSocket.register("createRandomPCActor", async (userId, actorData) => {
            if (!game.user.isGM) return { success: false };

            const requestingUser = game.users.get(userId);
            if (!requestingUser) return { success: false, error: "Invalid user." };

            // Allow infinite characters, but limit creation to ONCE per rollId
            const rollId = actorData.rollId;
            let createdRolls = requestingUser.getFlag(MODULE_ID, "createdRolls") || [];

            if (createdRolls.includes(rollId) && !requestingUser.isGM) {
                return { success: false, error: "limit_reached" };
            }

            let systemData = {
                details: { level: { value: actorData.level } }
            };

            if (actorData.stats) {
                systemData.build = { attributes: { manual: true } };
                systemData.abilities = {};
                for (const [key, val] of Object.entries(actorData.stats)) {
                    systemData.abilities[key] = { mod: val };
                }
            }

            // Create the empty actor
            const newActor = await Actor.create({
                name: actorData.name,
                type: "character",
                system: systemData,
                ownership: {
                    default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
                    [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
                }
            });

            // Mark this specific roll as used
            createdRolls.push(rollId);
            await requestingUser.setFlag(MODULE_ID, "createdRolls", createdRolls);

 
            // Send the ID back so the player's client can do it.
            return { success: true, actorId: newActor.id };
        });

    } else {
        console.warn("PF2e Awesome Macros For Players | Socketlib is not active. Some automations will not function.");
    }

    // Expose the Socketlib helper functions on your global namespace
    game.pf2eAwesomePlayerMacros.applyMagusImmunity = async (targetActor) => {
        if (!playerModuleSocket) return false;
        try {
            return await playerModuleSocket.executeAsGM("applyMagusImmunity", targetActor.uuid);
        } catch (error) {
            if (error.name === "SocketlibNoGMConnectedError") {
                ui.notifications.error("A Game Master must be online to apply the immunity tracker.");
            }
            return false;
        }
    };

    game.pf2eAwesomePlayerMacros.createRandomActor = async (actorData) => {
        if (!playerModuleSocket) {
            ui.notifications.error("Socketlib module not initialized. Ensure the Socketlib module is active.");
            return { success: false };
        }
        try {
            return await playerModuleSocket.executeAsGM("createRandomPCActor", game.user.id, actorData);
        } catch (error) {
            if (error.name === "SocketlibNoGMConnectedError") {
                ui.notifications.error("A Game Master must be online to generate your character sheet.");
            }
            return { success: false, error: "no_gm" };
        }
    };

    if (game.user.isGM) {
        const currentVersion = game.modules.get(MODULE_ID)?.version || "1.0.0";
        let folder = game.folders.getName(MACRO_FOLDER_NAME);
        const storedVersion = folder ? folder.getFlag(MODULE_ID, "moduleVersion") : null;

        // Run the Smart Sync if the version has changed
        if (currentVersion !== storedVersion) {
            await syncMacros();

            folder = game.folders.getName(MACRO_FOLDER_NAME);
            if (folder) {
                await folder.setFlag(MODULE_ID, "moduleVersion", currentVersion);
            }
        }
    }

    console.log('PF2e Awesome Macros for Players | All module logic and macros initialized.');
});