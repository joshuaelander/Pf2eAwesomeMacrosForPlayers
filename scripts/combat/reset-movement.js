/**
 * PF2e Reset Movement Macro
 * 
 * Purpose:
 * When in combat, moving tokens automatically tracks movement trails, waypoints,
 * and spent movement actions. If a player makes a mistake or changes their mind,
 * hitting Ctrl+Z repeatedly can be cumbersome, unreliable, or accidentally undo
 * other canvas operations.
 * 
 * Features:
 * - Detects the selected token (or player assigned character's active token).
 * - Identifies the token's recorded movement history and starting turn origin.
 * - Instantly reverts the token back to where its movement began in the current turn.
 * - Clears all recorded movement paths and waypoint trails from the canvas.
 * - Supports Foundry v14's native `TokenDocument.revertRecordedMovement()` with robust
 *   fallback coordinate snapping and Socketlib GM delegation if needed.
 * - Posts a stylized chat notification confirming the reset.
 */

export const RESET_MOVEMENT_MACRO_NAME = "Reset Movement";
export const RESET_MOVEMENT_MACRO_ICON = "icons/skills/movement/feet-winged-boots-blue.webp";

const MODULE_ID = "pf2e-awesome-macros-for-players";

/**
 * Socketlib handler to execute movement reset with GM permissions if the player client is restricted.
 */
export async function resetTokenMovementAsGM(tokenUuid, targetPos) {
    if (!tokenUuid) return false;
    const tokenDoc = await fromUuid(tokenUuid);
    if (!tokenDoc) return false;

    try {
        if (typeof tokenDoc.revertRecordedMovement === "function") {
            await tokenDoc.revertRecordedMovement();
        }

        if (targetPos && (tokenDoc.x !== targetPos.x || tokenDoc.y !== targetPos.y)) {
            await tokenDoc.update({
                x: targetPos.x,
                y: targetPos.y,
                elevation: targetPos.elevation ?? tokenDoc.elevation,
                action: "displace",
                _movementHistory: []
            }, { isUndo: true, diff: false });
        }

        if (typeof tokenDoc.clearMovementHistory === "function") {
            await tokenDoc.clearMovementHistory();
        }

        return true;
    } catch (err) {
        console.error("PF2e Awesome Macros For Players | GM failed to reset token movement:", err);
        return false;
    }
}

/**
 * Main macro execution.
 */
export async function executeResetMovement() {
    // 1. Identify selected token or player assigned character
    const controlled = canvas?.tokens?.controlled ?? [];
    let token = null;

    if (controlled.length === 1) {
        token = controlled[0];
    } else if (!game.user.isGM && game.user.character) {
        token = game.user.character.getActiveTokens()[0] ?? null;
    } else if (controlled.length > 1) {
        return ui.notifications.warn("Please select only one token to reset movement for.");
    }

    if (!token) {
        return ui.notifications.warn("Please select your character's token first.");
    }

    const tokenDoc = token.document;
    const actor = token.actor;

    // 2. Retrieve recorded movement history and turn start position
    const history = tokenDoc._source?._movementHistory ?? tokenDoc.movementHistory ?? [];
    const flagStartPos = tokenDoc.getFlag(MODULE_ID, "turnStartPosition");

    let targetPos = null;

    if (history.length > 0) {
        // history[0] is the recorded origin before any moves were made in this encounter/turn
        const origin = history[0];
        targetPos = {
            x: origin.x,
            y: origin.y,
            elevation: origin.elevation ?? tokenDoc.elevation
        };
    } else if (flagStartPos) {
        targetPos = {
            x: flagStartPos.x,
            y: flagStartPos.y,
            elevation: flagStartPos.elevation ?? tokenDoc.elevation
        };
    }

    // Check if the token has actually moved
    const hasMoved = targetPos && (tokenDoc.x !== targetPos.x || tokenDoc.y !== targetPos.y || (targetPos.elevation !== undefined && tokenDoc.elevation !== targetPos.elevation));

    if (!hasMoved && history.length === 0) {
        return ui.notifications.info(`${token.name} has not moved or is already at their starting position.`);
    }

    // Measure distance if possible for feedback
    let distanceMoved = 0;
    if (targetPos && canvas?.grid?.measurePath) {
        try {
            const pathMeasurement = canvas.grid.measurePath([
                { x: targetPos.x, y: targetPos.y },
                { x: tokenDoc.x, y: tokenDoc.y }
            ]);
            distanceMoved = Math.round(pathMeasurement?.distance ?? 0);
        } catch {
            distanceMoved = 0;
        }
    }

    // 3. Revert movement
    let reverted = false;

    // Step A: Attempt Foundry v14 native revertRecordedMovement()
    if (typeof tokenDoc.revertRecordedMovement === "function" && history.length > 0) {
        try {
            reverted = await tokenDoc.revertRecordedMovement();
        } catch (err) {
            console.warn("PF2e Awesome Macros For Players | Native revertRecordedMovement failed, attempting direct update", err);
        }
    }

    // Step B: If token is still not at targetPos, update directly
    if (targetPos && (tokenDoc.x !== targetPos.x || tokenDoc.y !== targetPos.y)) {
        try {
            await tokenDoc.update({
                x: targetPos.x,
                y: targetPos.y,
                elevation: targetPos.elevation ?? tokenDoc.elevation,
                action: "displace",
                _movementHistory: []
            }, { isUndo: true, diff: false });
            reverted = true;
        } catch (err) {
            // Step C: Fallback to Socketlib GM execution if player permissions restricted
            if (game.pf2eAwesomePlayerMacros?.resetTokenMovementAsGM) {
                reverted = await game.pf2eAwesomePlayerMacros.resetTokenMovementAsGM(tokenDoc.uuid, targetPos);
            } else {
                console.error("PF2e Awesome Macros For Players | Could not update token position", err);
            }
        }
    }

    // Step D: Ensure movement history trails are completely wiped
    if (typeof tokenDoc.clearMovementHistory === "function") {
        try {
            await tokenDoc.clearMovementHistory();
        } catch (err) {
            console.warn("PF2e Awesome Macros For Players | Could not clear movement history", err);
        }
    }

    // Refresh canvas ruler for this token
    if (token.rendered && token.renderFlags?.set) {
        token.renderFlags.set({ refreshRuler: true });
    }

    // 4. Reset Action Tracker integration (if active modules track action pips)
    if (game.combat) {
        const combatant = token.combatant ?? game.combat.combatants.find(c => c.tokenId === token.id);
        if (combatant) {
            // Check for Automated Action Tracker or similar module flags
            const aatFlags = combatant.flags?.["pf2e-automated-action-tracker"];
            if (aatFlags) {
                try {
                    // Reset spent actions if tracked in flags
                    if (aatFlags.actionsSpent !== undefined) {
                        await combatant.setFlag("pf2e-automated-action-tracker", "actionsSpent", 0);
                    }
                } catch (err) {
                    console.warn("PF2e Awesome Macros For Players | Could not reset action tracker flags", err);
                }
            }
        }
    }

    // 5. Notify player and post chat confirmation
    const distanceText = distanceMoved > 0 ? ` (${distanceMoved} ft reverted)` : "";
    ui.notifications.info(`Reset movement for ${token.name} back to starting position${distanceText}.`);

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${RESET_MOVEMENT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Reset Movement</h3>
                </header>
                <div class="card-content">
                    <p><strong>${token.name}</strong> reset their movement back to their starting position${distanceText}.</p>
                </div>
            </div>
        `
    });
}
