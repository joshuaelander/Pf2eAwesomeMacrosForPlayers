/**
 * PF2e Double Slice Macro (Fighter / Dual-Weapon Warrior)
 * 
 * Rules (Pathfinder Player Core / Remaster):
 * - Requirements: You are wielding two melee weapons, each in a different hand.
 * - Make two Strikes, one with each of your two melee weapons, each using your current
 *   Multiple Attack Penalty. Both Strikes must have the same target.
 * - If the second Strike is made with a weapon that doesn't have the agile trait,
 *   it takes a –2 penalty.
 * - If both attacks hit, combine their damage, and then add any other applicable effects
 *   from both weapons. Combine the damage from both Strikes and apply resistances
 *   and weaknesses only once.
 * - This counts as two attacks when calculating your multiple attack penalty.
 * 
 * Macro Features:
 * - Detects active token/actor (or player assigned character).
 * - Filters for ready 1-handed melee weapons.
 * - By default assigns an agile weapon to the second strike to avoid the -2 penalty.
 * - Provides dropdowns to swap or choose either weapon freely.
 * - Dynamic MAP handling: both attacks roll at the same MAP level (No MAP, MAP -5, or MAP -10).
 * - Live preview of attack modifiers directly in the setup dialog.
 * - Sequential attack rolls with 3D dice animation settle timing.
 * - Outcome confirmation dialog (Hit / Crit / Miss).
 * - Evaluates damage and combines both strikes into a unified DamageRoll chat card
 *   so that resistances and weaknesses apply only once (per PF2e RAW).
 */

export const DOUBLE_SLICE_MACRO_NAME = "Double Slice";
export const DOUBLE_SLICE_MACRO_ICON = "icons/skills/melee/weapons-crossed-swords-yellow.webp";

/**
 * Helper to capture the next chat message of a specific type from an actor.
 */
function captureNextRollMessage(actorId, rollType, timeoutMs = 12000) {
    return new Promise((resolve) => {
        const hookId = Hooks.on("createChatMessage", (msg) => {
            if (msg.actor?.id !== actorId) return;
            const context = msg.flags?.pf2e?.context;
            if (context?.type === rollType) {
                Hooks.off("createChatMessage", hookId);
                resolve(msg);
            }
        });
        setTimeout(() => {
            Hooks.off("createChatMessage", hookId);
            resolve(null);
        }, timeoutMs);
    });
}

/**
 * Checks if a strike item has a specific trait.
 */
function hasTrait(strike, trait) {
    const traits = strike?.item?.system?.traits?.value ?? (strike?.item?.traits ? Array.from(strike.item.traits) : []);
    return traits.includes(trait);
}

/**
 * Checks if a strike has the agile trait.
 */
function isAgile(strike) {
    return hasTrait(strike, "agile");
}

/**
 * Checks if a strike is a ready, one-handed melee weapon.
 */
function isOneHandedMeleeStrike(strike) {
    const item = strike?.item;
    if (!item) return false;
    if (!strike.ready) return false;
    if (!item.isMelee) return false;
    // Exclude strictly two-handed weapons
    if (item.system?.equipped?.handsHeld === 2) return false;
    return true;
}

/**
 * Helper to ensure a target token remains actively targeted in Foundry.
 */
function reassertTarget(targetToken) {
    if (!targetToken) return;
    try {
        const tokenObj = targetToken.object ?? targetToken;
        if (typeof tokenObj.setTarget === "function") {
            tokenObj.setTarget(true, { user: game.user, releaseOthers: false });
        }
    } catch (err) {
        console.warn("PF2e Double Slice | Could not reassert target", err);
    }
}

/**
 * Safe deep clone helper.
 */
function deepClone(obj) {
    if (!obj) return {};
    if (globalThis.foundry?.utils?.deepClone) {
        return foundry.utils.deepClone(obj);
    }
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return { ...obj };
    }
}

/**
 * Main macro execution.
 */
export async function executeDoubleSlice() {
    // 1. Get Actor and Token
    let actor = null;
    let token = null;
    const controlled = canvas?.tokens?.controlled ?? [];

    if (controlled.length === 1) {
        token = controlled[0];
        actor = token.actor;
    } else if (!game.user.isGM && game.user.character) {
        actor = game.user.character;
        token = actor.getActiveTokens()[0] ?? null;
    } else {
        return ui.notifications.warn("Please select your character's token first.");
    }

    if (!actor) {
        return ui.notifications.warn("No valid actor found.");
    }

    // 2. Identify Target
    const targets = Array.from(game.user.targets ?? []);
    let target = targets.length > 0 ? targets[0] : null;

    // 3. Check Double Slice feat
    const hasDS = actor.itemTypes.feat.some(f => f.slug === "double-slice")
        || actor.items.some(i => i.slug === "double-slice" || i.name === "Double Slice" || i.name?.toLowerCase().includes("double slice"));

    if (!hasDS) {
        if (game.user.isGM) {
            ui.notifications.warn(`${actor.name} does not appear to have Double Slice (proceeding as GM).`);
        } else {
            ui.notifications.warn(`Reminder: ${actor.name} does not appear to have the Double Slice feat.`);
        }
    }

    // 4. Find Available Ready One-Handed Melee Strikes
    const availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && isOneHandedMeleeStrike(a)) ?? [];

    if (availableStrikes.length === 0) {
        return ui.notifications.error("No ready one-handed melee weapons found on this character.");
    }

    // 5. Determine default weapon ordering
    // If an agile weapon is wielded alongside a non-agile weapon, default the agile weapon to Strike 2
    let defaultIdx1 = 0;
    let defaultIdx2 = availableStrikes.length > 1 ? 1 : 0;

    if (availableStrikes.length >= 2) {
        const agile0 = isAgile(availableStrikes[0]);
        const agile1 = isAgile(availableStrikes[1]);

        if (agile0 && !agile1) {
            defaultIdx1 = 1; // non-agile as Weapon 1
            defaultIdx2 = 0; // agile as Weapon 2
        } else if (!agile0 && agile1) {
            defaultIdx1 = 0; // non-agile as Weapon 1
            defaultIdx2 = 1; // agile as Weapon 2
        }
    }

    // 6. Build Initial Setup Dialog
    const targetInfoHtml = target 
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px;">
             <strong>Target:</strong> ${target.name}
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.08); border-left: 3px solid #f57c00; border-radius: 3px;">
             <em style="font-size: 0.9em; color: #555;">No target selected. (Targeting an enemy is recommended for automatic hit detection & damage application).</em>
           </div>`;

    const getStrikeOptionLabel = (strike) => {
        const bonus0 = strike.variants?.[0]?.label ?? "+0";
        const traits = [];
        if (isAgile(strike)) traits.push("Agile");
        const traitsStr = traits.length > 0 ? ` [${traits.join(", ")}]` : "";
        return `${strike.label} (${bonus0})${traitsStr}`;
    };

    const strike1OptionsHtml = availableStrikes.map((s, idx) => 
        `<option value="${idx}" ${idx === defaultIdx1 ? "selected" : ""}>${getStrikeOptionLabel(s)}</option>`
    ).join("");

    const strike2OptionsHtml = availableStrikes.map((s, idx) => 
        `<option value="${idx}" ${idx === defaultIdx2 ? "selected" : ""}>${getStrikeOptionLabel(s)}</option>`
    ).join("");

    const setupDialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            ${targetInfoHtml}
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">First Strike (Primary Weapon):</label>
                <select id="ds-strike-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strike1OptionsHtml}
                </select>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Second Strike (Secondary Weapon):</label>
                <select id="ds-strike-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strike2OptionsHtml}
                </select>
                <small style="font-size: 0.8em; color: #666; display: block; margin-top: 2px;">
                    <em>(Takes a –2 penalty if this weapon does not have the agile trait).</em>
                </small>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Current Multiple Attack Penalty (Starting MAP):</label>
                <select id="ds-starting-map" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="0" selected>No MAP (0 prior attacks this turn)</option>
                    <option value="1">MAP -5 (1 prior attack this turn)</option>
                    <option value="2">MAP -10 (2+ prior attacks this turn)</option>
                </select>
            </div>
            <div id="ds-live-preview" style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px; font-size: 0.9em;">
                <div id="ds-preview-content"></div>
            </div>
            <p style="font-size: 0.85em; color: #555; margin: 0; font-style: italic;">
                Double Slice makes two Strikes at your current Multiple Attack Penalty. If both hit, their damage will be combined before applying resistances and weaknesses.
            </p>
        </div>
    `;

    new Dialog({
        title: "Double Slice",
        content: setupDialogContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            },
            roll: {
                icon: '<i class="fas fa-crossed-swords"></i>',
                label: "Execute Double Slice",
                callback: async (html) => {
                    const strike1Idx = parseInt(html.find("#ds-strike-1").val(), 10) || 0;
                    const strike2Idx = parseInt(html.find("#ds-strike-2").val(), 10) || 0;
                    const startingMap = parseInt(html.find("#ds-starting-map").val(), 10) || 0;

                    if (!target && game.user.targets?.size > 0) {
                        target = Array.from(game.user.targets)[0];
                    }

                    const chosenStrike1 = availableStrikes[strike1Idx] || availableStrikes[0];
                    const chosenStrike2 = availableStrikes[strike2Idx] || availableStrikes[0];

                    await runDoubleSliceSequence(actor, token, target, chosenStrike1, chosenStrike2, startingMap);
                }
            }
        },
        default: "roll",
        render: (html) => {
            const updatePreview = () => {
                const s1Idx = parseInt(html.find("#ds-strike-1").val(), 10) || 0;
                const s2Idx = parseInt(html.find("#ds-strike-2").val(), 10) || 0;
                const startingMap = parseInt(html.find("#ds-starting-map").val(), 10) || 0;

                const chosen1 = availableStrikes[s1Idx] || availableStrikes[0];
                const chosen2 = availableStrikes[s2Idx] || availableStrikes[0];

                const mapIndex = Math.min(startingMap, 2);

                const b1 = chosen1.variants?.[mapIndex]?.label ?? "+0";
                const baseB2Str = chosen2.variants?.[mapIndex]?.label ?? "+0";
                const baseB2Num = parseInt(baseB2Str, 10);

                const s2IsAgile = isAgile(chosen2);
                let b2 = baseB2Str;
                let s2PenaltyBadge = "";

                if (s2IsAgile) {
                    s2PenaltyBadge = `<span style="color: #2e7d32; font-weight: bold;">[Agile]</span>`;
                } else {
                    if (!isNaN(baseB2Num)) {
                        const modifiedB2 = baseB2Num - 2;
                        b2 = `${modifiedB2 >= 0 ? "+" : ""}${modifiedB2}`;
                    }
                    s2PenaltyBadge = `<span style="color: #b75300; font-weight: bold;">[-2 Non-Agile Penalty]</span>`;
                }

                const mapLabel = mapIndex === 0 ? "No MAP" : (mapIndex === 1 ? "1st MAP" : "2nd MAP");

                html.find("#ds-preview-content").html(`
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div><strong>Strike 1:</strong> ${chosen1.label} (<strong>${b1}</strong>) <small style="color: #666;">[${mapLabel}]</small></div>
                        <div><strong>Strike 2:</strong> ${chosen2.label} (<strong>${b2}</strong>) <small style="color: #666;">[${mapLabel}]</small> ${s2PenaltyBadge}</div>
                    </div>
                `);
            };

            updatePreview();
            html.find("#ds-strike-1, #ds-strike-2, #ds-starting-map").on("change", updatePreview);
        }
    }).render(true);
}

/**
 * Executes the attack rolls, confirms outcomes, rolls damages, and combines them if applicable.
 */
async function runDoubleSliceSequence(actor, token, target, strike1, strike2, startingMap) {
    const mapIndex = Math.min(startingMap, 2);
    const mapTag = mapIndex === 0 ? "No MAP" : (mapIndex === 1 ? "MAP (1 attack)" : "MAP (2+ attacks)");

    const isSecondAgile = isAgile(strike2);

    // 1. Post Double Slice Header to Chat
    const targetText = target ? ` against <strong>${target.name}</strong>` : "";
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${DOUBLE_SLICE_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Double Slice</h3>
                </header>
                <div class="card-content">
                    <p><strong>${actor.name}</strong> lashes out with both weapons${targetText}!</p>
                </div>
            </div>
        `
    });

    // 2. Roll Strike 1
    reassertTarget(target);
    const attack1Promise = captureNextRollMessage(actor.id, "attack-roll");
    await strike1.variants[mapIndex].roll({
        target: target?.object ?? target,
        extraRollOptions: ["action:double-slice"]
    });
    const attack1Msg = await attack1Promise;

    if (!target && attack1Msg?.target?.token?.object) {
        target = attack1Msg.target.token.object;
    }

    // Wait 1.5s to let dice settle
    await new Promise(r => setTimeout(r, 1500));

    // 3. Roll Strike 2 (Apply -2 circumstance penalty if not agile)
    reassertTarget(target);
    const attack2Promise = captureNextRollMessage(actor.id, "attack-roll");

    const rollArgs2 = {
        target: target?.object ?? target,
        extraRollOptions: ["action:double-slice"]
    };

    if (!isSecondAgile && globalThis.game?.pf2e?.Modifier) {
        rollArgs2.modifiers = [
            new game.pf2e.Modifier({
                slug: "double-slice-penalty",
                label: "Double Slice (Non-Agile)",
                modifier: -2,
                type: "circumstance"
            })
        ];
    }

    await strike2.variants[mapIndex].roll(rollArgs2);
    const attack2Msg = await attack2Promise;

    if (!target && attack2Msg?.target?.token?.object) {
        target = attack2Msg.target.token.object;
    }

    // Wait 1.2s to let dice settle
    await new Promise(r => setTimeout(r, 1200));

    // 4. Parse detected outcomes
    const parseOutcome = (msg) => {
        const outcome = msg?.flags?.pf2e?.context?.outcome;
        if (outcome === "criticalSuccess") return "crit";
        if (outcome === "success") return "hit";
        if (outcome === "failure" || outcome === "criticalFailure") return "miss";
        return "hit";
    };

    const detected1 = parseOutcome(attack1Msg);
    const detected2 = parseOutcome(attack2Msg);

    const strike1Summary = attack1Msg?.rolls?.[0]?.total ? ` (Total: ${attack1Msg.rolls[0].total})` : "";
    const strike2Summary = attack2Msg?.rolls?.[0]?.total ? ` (Total: ${attack2Msg.rolls[0].total})` : "";

    const s2PenaltyLabel = isSecondAgile ? "" : " [-2 Non-Agile Penalty]";

    // 5. Outcome & Damage Confirmation Dialog
    const confirmContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; font-size: 0.95em;">Confirm the outcomes of both strikes to roll damage:</p>
            <div style="margin-bottom: 10px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 1: ${strike1.label} [${mapTag}]${strike1Summary}</label>
                <select id="ds-outcome-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected1 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected1 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected1 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
            <div style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 2: ${strike2.label} [${mapTag}]${s2PenaltyLabel}${strike2Summary}</label>
                <select id="ds-outcome-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected2 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected2 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected2 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
        </div>
    `;

    new Dialog({
        title: "Double Slice: Confirm Hits",
        content: confirmContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            },
            rollDamage: {
                icon: '<i class="fas fa-dice-d20"></i>',
                label: "Roll Damage",
                callback: async (html) => {
                    const outcome1 = html.find("#ds-outcome-1").val();
                    const outcome2 = html.find("#ds-outcome-2").val();

                    await resolveDoubleSliceDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, mapIndex, isSecondAgile);
                }
            }
        },
        default: "rollDamage"
    }).render(true);
}

/**
 * Rolls damage for each hit and combines them if both attacks succeeded.
 */
async function resolveDoubleSliceDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, mapIndex, isSecondAgile) {
    const hit1 = outcome1 !== "miss";
    const hit2 = outcome2 !== "miss";

    if (!target) {
        target = attack1Msg?.target?.token?.object ?? attack2Msg?.target?.token?.object ?? null;
    }

    // Helper to execute single strike damage with full attack context and target passed
    const rollSingleStrikeDamage = async (strike, outcome, attackMsg) => {
        reassertTarget(target);
        const isCrit = outcome === "crit";
        const attackContext = attackMsg?.flags?.pf2e?.context ?? null;
        const targetObj = target?.object ?? target ?? null;

        const rollArgs = {
            checkContext: attackContext,
            target: targetObj,
            outcome: isCrit ? "criticalSuccess" : "success"
        };

        try {
            if (isCrit) {
                return await strike.critical(rollArgs);
            } else {
                return await strike.damage(rollArgs);
            }
        } catch (err) {
            console.warn("PF2e Double Slice | Error rolling strike with rollArgs, falling back to default", err);
            return isCrit ? await strike.critical() : await strike.damage();
        }
    };

    // Case 1: Both Missed
    if (!hit1 && !hit2) {
        return ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor, token }),
            content: `
                <div class="pf2e chat-card">
                    <header class="card-header flexrow">
                        <img src="${DOUBLE_SLICE_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                        <h3>Double Slice - Complete</h3>
                    </header>
                    <div class="card-content">
                        <p><em>Both strikes of Double Slice missed. No damage dealt.</em></p>
                    </div>
                </div>
            `
        });
    }

    // Case 2: Only Strike 1 Hit
    if (hit1 && !hit2) {
        await rollSingleStrikeDamage(strike1, outcome1, attack1Msg);
        return;
    }

    // Case 3: Only Strike 2 Hit
    if (!hit1 && hit2) {
        await rollSingleStrikeDamage(strike2, outcome2, attack2Msg);
        return;
    }

    // Case 4: BOTH Hit (Combine damage per Double Slice rules!)
    // 1. Roll Damage 1
    const dmg1Promise = captureNextRollMessage(actor.id, "damage-roll");
    await rollSingleStrikeDamage(strike1, outcome1, attack1Msg);
    const dmg1Msg = await dmg1Promise;

    // Pause for dice animations
    await new Promise(r => setTimeout(r, 1500));

    // 2. Roll Damage 2
    const dmg2Promise = captureNextRollMessage(actor.id, "damage-roll");
    await rollSingleStrikeDamage(strike2, outcome2, attack2Msg);
    const dmg2Msg = await dmg2Promise;

    // Pause for dice animations
    await new Promise(r => setTimeout(r, 1200));

    // 3. Extract and combine damage instances
    const roll1 = dmg1Msg?.rolls?.[0];
    const roll2 = dmg2Msg?.rolls?.[0];

    const combinedByType = {};

    const collectDamage = (roll, fallbackStrike) => {
        if (!roll) return;
        if (roll.instances && roll.instances.length > 0) {
            for (const inst of roll.instances) {
                const type = inst.persistent ? `${inst.type},persistent` : (inst.type || "untyped");
                combinedByType[type] = (combinedByType[type] || 0) + inst.total;
            }
        } else {
            const type = fallbackStrike.item?.system?.damage?.damageType || "slashing";
            combinedByType[type] = (combinedByType[type] || 0) + (roll.total ?? 0);
        }
    };

    collectDamage(roll1, strike1);
    collectDamage(roll2, strike2);

    const formulaParts = Object.entries(combinedByType).map(([type, total]) => `${total}[${type}]`);
    const combinedFormula = formulaParts.join(", ");
    const totalDamage = Object.values(combinedByType).reduce((a, b) => a + b, 0);

    const mapTag = mapIndex === 0 ? "No MAP" : (mapIndex === 1 ? "MAP -5" : "MAP -10");
    const s2PenaltyTag = isSecondAgile ? "" : " [-2 Non-Agile Penalty]";

    const breakdown1 = `${strike1.label} (${outcome1 === "crit" ? "Critical Hit" : "Hit"}, ${mapTag}): ${roll1?.total ?? 0}`;
    const breakdown2 = `${strike2.label} (${outcome2 === "crit" ? "Critical Hit" : "Hit"}, ${mapTag}${s2PenaltyTag}): ${roll2?.total ?? 0}`;

    // Target information extraction for flags and display
    reassertTarget(target);
    const targetTokenDoc = target?.document ?? target;
    const targetActorDoc = target?.actor ?? null;
    const targetTokenUuid = targetTokenDoc?.uuid ?? (target ? `Scene.${canvas.scene?.id}.Token.${target.id}` : null);
    const targetActorUuid = targetActorDoc?.uuid ?? targetTokenDoc?.actorId ?? null;

    const targetData = targetTokenUuid ? {
        token: targetTokenUuid,
        actor: targetActorUuid
    } : (attack1Msg?.flags?.pf2e?.context?.target ?? dmg1Msg?.flags?.pf2e?.context?.target ?? null);

    // Build flags merging PF2e damage context and module flags
    const combinedFlags = deepClone(dmg1Msg?.flags ?? {});
    combinedFlags.pf2e = combinedFlags.pf2e || {};
    combinedFlags.pf2e.context = {
        ...(dmg1Msg?.flags?.pf2e?.context ?? attack1Msg?.flags?.pf2e?.context ?? {}),
        type: "damage-roll",
        sourceType: "attack",
        actor: actor.id,
        target: targetData,
        domains: ["damage-roll", "strike-damage"]
    };

    if (targetData) {
        combinedFlags.pf2e.target = targetData;
    }

    if (dmg1Msg?.flags?.["pf2e-toolbelt"]) {
        combinedFlags["pf2e-toolbelt"] = deepClone(dmg1Msg.flags["pf2e-toolbelt"]);
    }
    if (dmg1Msg?.flags?.["pf2e-target-damage"]) {
        combinedFlags["pf2e-target-damage"] = deepClone(dmg1Msg.flags["pf2e-target-damage"]);
    }

    const targetImg = target?.document?.texture?.src ?? target?.actor?.img ?? "icons/svg/target.svg";
    const targetHeaderHtml = target ? `
        <div style="display: flex; align-items: center; gap: 8px; margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #b71c1c; border-radius: 4px;">
            <img src="${targetImg}" width="32" height="32" style="border-radius: 4px; border: 1px solid #777; object-fit: cover; flex-shrink: 0;"/>
            <div>
                <div style="font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.5px; color: #555; font-weight: bold; line-height: 1;">Targeted Enemy</div>
                <div style="font-weight: bold; font-size: 1.05em; color: #222;">${target.name}</div>
            </div>
        </div>
    ` : "";

    const cardFlavorHtml = `
        <div class="pf2e chat-card">
            <header class="card-header flexrow">
                <img src="${DOUBLE_SLICE_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                <h3>Double Slice - Combined Damage</h3>
            </header>
            <div class="card-content">
                ${targetHeaderHtml}
                <p style="margin-bottom: 4px;"><strong>Combined for Resistances & Weaknesses:</strong></p>
                <p style="font-size: 0.85em; color: #444; border-left: 3px solid #990000; padding-left: 6px; background: rgba(0,0,0,0.03); margin: 0 0 6px 0;">
                    • ${breakdown1}<br>
                    • ${breakdown2}
                </p>
            </div>
        </div>
    `;

    // 4. Create the Combined DamageRoll Card
    try {
        const DamageRoll = CONFIG.Dice.rolls.find((r) => r.name === "DamageRoll");
        if (DamageRoll && combinedFormula) {
            const combinedRoll = new DamageRoll(combinedFormula);
            await combinedRoll.evaluate();

            await combinedRoll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor, token }),
                flavor: cardFlavorHtml,
                flags: combinedFlags
            });
            return;
        }
    } catch (err) {
        console.error("PF2e Double Slice | Failed to evaluate DamageRoll, using fallback", err);
    }

    // Fallback message if DamageRoll could not be instantiated
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${DOUBLE_SLICE_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Double Slice - Combined Damage</h3>
                </header>
                <div class="card-content">
                    ${targetHeaderHtml}
                    <p><strong>Combined Damage:</strong> @Damage[${combinedFormula}]</p>
                    <p style="font-size: 0.85em; color: #444;">
                        • ${breakdown1}<br>
                        • ${breakdown2}
                    </p>
                </div>
            </div>
        `,
        flags: combinedFlags
    });
}
