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

import {
    mastermindRecall,
    MASTERMIND_RECALL_MACRO_NAME,
    MASTERMIND_RECALL_MACRO_ICON,
    applyMastermindOffGuardAsGM
} from "./mastermind-rogues-recall.js";

import {
    executeFlurryOfBlows,
    FLURRY_OF_BLOWS_MACRO_NAME,
    FLURRY_OF_BLOWS_MACRO_ICON
} from "./flurry-of-blows.js";

import {
    executeHuntedShot,
    HUNTED_SHOT_MACRO_NAME,
    HUNTED_SHOT_MACRO_ICON
} from "./hunted-shot.js";

import {
    openPartyStash,
    OPEN_PARTY_STASH_MACRO_NAME,
    OPEN_PARTY_STASH_MACRO_ICON
} from "./open-party-stash.js";

import {
    executeInstructiveStrike,
    INSTRUCTIVE_STRIKE_MACRO_NAME,
    INSTRUCTIVE_STRIKE_MACRO_ICON
} from "./instructive-strike.js";

import {
    executeDoubleSlice,
    DOUBLE_SLICE_MACRO_NAME,
    DOUBLE_SLICE_MACRO_ICON
} from "./double-slice.js";

// --- THE DESIRED MACRO STATE ---
const DESIRED_MACROS = [
    // General / Utility Macros (Root folder)
    { name: ROLL_RANDOM_CHARACTER_MACRO_NAME, icon: ROLL_RANDOM_CHARACTER_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.createCharacter();`, category: null },
    { name: EXPLORATION_ACTIVITY_MACRO_NAME, icon: EXPLORATION_ACTIVITY_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.addExplorationActivity();`, category: null },
    { name: OPEN_PARTY_STASH_MACRO_NAME, icon: OPEN_PARTY_STASH_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.openPartyStash();`, category: null },

    // Recall Knowledge Subfolder
    { name: ENHANCED_RECALL_MACRO_NAME, icon: ENHANCED_RECALL_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.openRecallKnowledgeDialog();`, category: "Recall Knowledge" },
    { name: MONSTER_HUNTER_MACRO_NAME, icon: MONSTER_HUNTER_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeMonsterHunter();`, category: "Recall Knowledge" },
    { name: KNOWN_WEAKNESSES_MACRO_NAME, icon: KNOWN_WEAKNESSES_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeKnownWeaknesses();`, category: "Recall Knowledge" },
    { name: COMBAT_ASSESSMENT_MACRO_NAME, icon: COMBAT_ASSESSMENT_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeCombatAssessment();`, category: "Recall Knowledge" },
    { name: MAGUS_ANALYSIS_MACRO_NAME, icon: MAGUS_ANALYSIS_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeMagusAnalysis();`, category: "Recall Knowledge" },
    { name: MASTERMIND_RECALL_MACRO_NAME, icon: MASTERMIND_RECALL_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.mastermindRecall();`, category: "Recall Knowledge" },
    { name: INSTRUCTIVE_STRIKE_MACRO_NAME, icon: INSTRUCTIVE_STRIKE_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeInstructiveStrike();`, category: "Recall Knowledge" },

    // Combat Subfolder
    { name: FLURRY_OF_BLOWS_MACRO_NAME, icon: FLURRY_OF_BLOWS_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeFlurryOfBlows();`, category: "Combat" },
    { name: HUNTED_SHOT_MACRO_NAME, icon: HUNTED_SHOT_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeHuntedShot();`, category: "Combat" },
    { name: DOUBLE_SLICE_MACRO_NAME, icon: DOUBLE_SLICE_MACRO_ICON, command: `game.pf2eAwesomePlayerMacros.executeDoubleSlice();`, category: "Combat" }
];

// --- HELPER FUNCTIONS --- //
/**
 * Gets an existing folder by name and type, or creates it if it doesn't exist.
 * Supports nesting subfolders under a parent folder.
 */
async function getOrCreateFolder(name, type, parentId = null, color = MACRO_FOLDER_COLOR) {
    // 1. Try to find a folder that already has the desired parentId
    let folder = game.folders.find(f => {
        if (f.name !== name || f.type !== type) return false;
        const currentParent = f._source?.folder ?? f.folder?.id ?? (typeof f.folder === "string" ? f.folder : null);
        return parentId ? currentParent === parentId : !currentParent;
    });

    // 2. If not found with exact parent, check if a folder with this name/type already exists (e.g. previously at root)
    if (!folder) {
        folder = game.folders.find(f => f.name === name && f.type === type);
    }

    if (folder) {
        // Ensure its parent folder hierarchy and color are up to date
        const currentParent = folder._source?.folder ?? folder.folder?.id ?? (typeof folder.folder === "string" ? folder.folder : null);
        if (currentParent !== parentId || folder.color !== color) {
            try {
                await folder.update({
                    folder: parentId,
                    color: color
                });
                console.log(`PF2e Awesome Macros For Players | Updated folder "${name}" to parent "${parentId}".`);
            } catch (err) {
                console.warn(`PF2e Awesome Macros For Players | Failed to update folder hierarchy for: ${name}`, err);
            }
        }
        return folder;
    }

    // 3. Otherwise create the folder with the correct parent 'folder' property
    try {
        folder = await Folder.create({
            name: name,
            type: type,
            folder: parentId,
            color: color
        });
        ui.notifications.info(`[PF2e Awesome Macros For Players] Created folder: ${name}.`);
    } catch (err) {
        console.error(`PF2e Awesome Macros For Players | Failed to create folder: ${name}`, err);
        return null;
    }
    return folder;
}

/**
 * Compares the existing macros in the world to the DESIRED_MACROS list.
 * Creates missing macros, updates existing ones, organizes them into subfolders,
 * and deletes obsolete ones.
 */
async function syncMacros() {
    const rootFolder = await getOrCreateFolder(MACRO_FOLDER_NAME, 'Macro', null, MACRO_FOLDER_COLOR);
    if (!rootFolder) return;

    // Create or retrieve subfolders for organization
    const rkFolder = await getOrCreateFolder("Recall Knowledge", 'Macro', rootFolder.id, "#1976d2");
    const combatFolder = await getOrCreateFolder("Combat", 'Macro', rootFolder.id, "#b71c1c");

    const categoryFolders = {
        "Recall Knowledge": rkFolder,
        "Combat": combatFolder
    };

    const desiredNames = DESIRED_MACROS.map(m => m.name);
    const moduleFolderIds = [rootFolder?.id, rkFolder?.id, combatFolder?.id].filter(Boolean);

    // Identify module macros: by module flag, or by name matching a desired macro in our folders/root
    const existingMacros = game.macros.filter(m => {
        if (m.flags?.[MODULE_ID]?.isModuleMacro) return true;
        if (desiredNames.includes(m.name) && (moduleFolderIds.includes(m.folder?.id) || !m.folder)) return true;
        return false;
    });

    const observerOwnership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };

    // Only delete macros that were explicitly created by this module (flagged) and are no longer desired
    const obsoleteIds = existingMacros.filter(m => m.flags?.[MODULE_ID]?.isModuleMacro && !desiredNames.includes(m.name)).map(m => m.id);
    if (obsoleteIds.length > 0) {
        await Macro.deleteDocuments(obsoleteIds);
        console.log(`PF2e Awesome Macros For Players | Deleted ${obsoleteIds.length} obsolete macros.`);
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const desired of DESIRED_MACROS) {
        const existing = existingMacros.find(m => m.name === desired.name);
        const targetFolder = (desired.category && categoryFolders[desired.category]) ? categoryFolders[desired.category] : rootFolder;

        if (existing) {
            // Check if command, icon, folder, ownership permissions, or flag are out of sync
            const needsUpdate =
                existing.command !== desired.command ||
                existing.img !== desired.icon ||
                existing.folder?.id !== targetFolder.id ||
                existing.ownership.default !== observerOwnership.default ||
                !existing.flags?.[MODULE_ID]?.isModuleMacro;

            if (needsUpdate) {
                await existing.update({
                    command: desired.command,
                    img: desired.icon,
                    folder: targetFolder.id,
                    ownership: observerOwnership,
                    [`flags.${MODULE_ID}.isModuleMacro`]: true
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
                folder: targetFolder.id,
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

// --- MODULE SETTINGS INTEGRATION ---
export function registerSettings() {
    game.settings.register(MODULE_ID, 'hideModifierBreakdown', {
        name: 'Hide Modifier Breakdown',
        hint: 'If enabled, hides the math breakdown (e.g., 10+6) in the GM chat card.',
        scope: 'world', config: true, type: Boolean, default: false
    });

    game.settings.register(MODULE_ID, 'failureBehavior', {
        name: 'Failure Behavior',
        hint: 'How should normal Failures be handled regarding Dubious Knowledge?',
        scope: 'world', config: true, type: String,
        choices: {
            'failureOnly': 'Failure Only (Never use Dubious Knowledge)',
            'dubiousKnowledge': 'RAW (Only if actor has Dubious Knowledge feat)',
            'alwaysDubious': 'Always use Dubious Knowledge'
        },
        default: 'dubiousKnowledge'
    });

    game.settings.register(MODULE_ID, 'autoReply', {
        name: 'Auto-Reply to Player',
        hint: 'Automatically whispers the result to the rolling player based on their degree of success.',
        scope: 'world', config: true, type: Boolean, default: false
    });

    game.settings.register(MODULE_ID, 'disableGMColors', {
        name: 'Disable Colors in GM Results',
        hint: 'If enabled, removes the success/failure color coding from the GM chat card to prevent accidental screen-peek metagaming.',
        scope: 'world', config: true, type: Boolean, default: false
    });
}

// --- HOOKS --- //
Hooks.once('init', () => {
    registerSettings();
});

// Hook to handle the "Create Actor" button on the chat card for players
Hooks.on("renderChatMessage", (message, html, data) => {
    handlePlayerCreateButton(message, html, data);
});

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
    game.pf2eAwesomePlayerMacros.mastermindRecall = mastermindRecall;
    game.pf2eAwesomePlayerMacros.executeFlurryOfBlows = executeFlurryOfBlows;
    game.pf2eAwesomePlayerMacros.executeHuntedShot = executeHuntedShot;
    game.pf2eAwesomePlayerMacros.openPartyStash = openPartyStash;
    game.pf2eAwesomePlayerMacros.executeInstructiveStrike = executeInstructiveStrike;
    game.pf2eAwesomePlayerMacros.executeDoubleSlice = executeDoubleSlice;

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

        // 3. Mastermind Recall Socket
        playerModuleSocket.register("applyMastermindOffGuard", applyMastermindOffGuardAsGM);

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

    game.pf2eAwesomePlayerMacros.applyMastermindOffGuard = async (targetActorUuid, durationValue, sourceActorUuid) => {
        if (!playerModuleSocket) return false;
        try {
            return await playerModuleSocket.executeAsGM("applyMastermindOffGuard", targetActorUuid, durationValue, sourceActorUuid);
        } catch (error) {
            if (error.name === "SocketlibNoGMConnectedError") {
                ui.notifications.error("A Game Master must be online to apply the Mastermind effect.");
            }
            return false;
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