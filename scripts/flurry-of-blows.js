/**
 * PF2e Flurry of Blows Macro (Monk)
 * 
 * Features:
 * - Detects active token/actor (or player assigned character).
 * - Filters for ready unarmed attacks and monk weapons.
 * - Allows selecting separate strikes for Attack 1 and Attack 2.
 * - Supports starting at any Multiple Attack Penalty (MAP 0, 1, or 2) and progresses MAP normally.
 * - Rolls both attack strikes sequentially with clean dice animation timing.
 * - Captures outcomes (Hit / Crit / Miss) with an interactive confirmation dialog.
 * - Rolls damage for each hitting strike so individual damage cards appear in chat.
 * - Combines damage instances from both hits into a unified DamageRoll chat card
 *   so that resistances and weaknesses apply only once (as per PF2e RAW).
 */

export const FLURRY_OF_BLOWS_MACRO_NAME = "Flurry of Blows";
export const FLURRY_OF_BLOWS_MACRO_ICON = "icons/skills/melee/unarmed-punch-fist.webp";

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
 * Main macro execution.
 */
export async function executeFlurryOfBlows() {
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

    // 2. Identify Target (if any)
    const targets = Array.from(game.user.targets ?? []);
    let target = targets.length > 0 ? targets[0] : null;

    // 3. Find Available Strikes (Unarmed or Monk weapons preferred)
    const isUnarmedOrMonk = (strike) => {
        const traits = strike.item?.system?.traits?.value ?? (strike.item?.traits ? Array.from(strike.item.traits) : []);
        const isUnarmed = strike.item?.category === "unarmed" || traits.includes("unarmed");
        const isMonk = traits.includes("monk");
        return isUnarmed || isMonk;
    };

    let availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready && isUnarmedOrMonk(a)) ?? [];
    if (availableStrikes.length === 0) {
        // Fallback: any ready melee strike
        availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready && a.item?.isMelee) ?? [];
    }

    if (availableStrikes.length === 0) {
        return ui.notifications.error("No ready unarmed or melee strikes found on this character.");
    }

    // 4. Build Initial Setup Dialog (Strike selection & Starting MAP)
    const targetInfoHtml = target 
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 3px;">
             <strong>Target:</strong> ${target.name}
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.08); border-left: 3px solid #f57c00; border-radius: 3px;">
             <em style="font-size: 0.9em; color: #555;">No target selected. (Targeting an enemy is recommended for automatic hit detection & damage application).</em>
           </div>`;

    const strikeOptionsHtml = availableStrikes.map((s, idx) => {
        const bonus0 = s.variants?.[0]?.label ?? "+0";
        return `<option value="${idx}">${s.label} (${bonus0})</option>`;
    }).join("");

    const setupDialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            ${targetInfoHtml}
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike for Attack 1:</label>
                <select id="fob-strike-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strikeOptionsHtml}
                </select>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike for Attack 2:</label>
                <select id="fob-strike-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strikeOptionsHtml}
                </select>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Current Multiple Attack Penalty (Starting MAP):</label>
                <select id="fob-starting-map" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="0" selected>No MAP</option>
                    <option value="1">MAP -5</option>
                    <option value="2">MAP -10</option>
                </select>
            </div>
            <div id="fob-live-preview" style="margin-bottom: 12px; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px; font-size: 0.9em;">
                <div id="fob-preview-content"></div>
            </div>
            <p style="font-size: 0.85em; color: #555; margin: 0; font-style: italic;">
                Flurry of Blows makes two strikes, progressing MAP normally. If both hit, their damage will be combined.
            </p>
        </div>
    `;

    new Dialog({
        title: "Flurry of Blows",
        content: setupDialogContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            },
            roll: {
                icon: '<i class="fas fa-fist-raised"></i>',
                label: "Unleash Flurry",
                callback: async (html) => {
                    const strike1Idx = parseInt(html.find("#fob-strike-1").val(), 10) || 0;
                    const strike2Idx = parseInt(html.find("#fob-strike-2").val(), 10) || 0;
                    const startingMap = parseInt(html.find("#fob-starting-map").val(), 10) || 0;

                    // Re-check target in case user targeted an enemy while dialog was open
                    if (!target && game.user.targets?.size > 0) {
                        target = Array.from(game.user.targets)[0];
                    }

                    const chosenStrike1 = availableStrikes[strike1Idx] || availableStrikes[0];
                    const chosenStrike2 = availableStrikes[strike2Idx] || availableStrikes[0];

                    await runFlurrySequence(actor, token, target, chosenStrike1, chosenStrike2, startingMap);
                }
            }
        },
        default: "roll",
        render: (html) => {
            const updateMapOptions = () => {
                const s1Idx = parseInt(html.find("#fob-strike-1").val(), 10) || 0;
                const s2Idx = parseInt(html.find("#fob-strike-2").val(), 10) || 0;
                const chosen1 = availableStrikes[s1Idx] || availableStrikes[0];
                const chosen2 = availableStrikes[s2Idx] || availableStrikes[0];

                const s1Penalty1 = getStrikeMapPenalty(chosen1, 1);
                const s1Penalty2 = getStrikeMapPenalty(chosen1, 2);
                const s2Penalty1 = getStrikeMapPenalty(chosen2, 1);
                const s2Penalty2 = getStrikeMapPenalty(chosen2, 2);

                const s1Bonus0 = chosen1.variants?.[0]?.label ?? "+0";
                const s1Bonus1 = chosen1.variants?.[1]?.label ?? `${s1Penalty1}`;
                const s1Bonus2 = chosen1.variants?.[2]?.label ?? `${s1Penalty2}`;

                const s2Bonus0 = chosen2.variants?.[0]?.label ?? "+0";
                const s2Bonus1 = chosen2.variants?.[1]?.label ?? `${s2Penalty1}`;
                const s2Bonus2 = chosen2.variants?.[2]?.label ?? `${s2Penalty2}`;

                const opt0Text = `No MAP (No prior attacks: 1st [${s1Bonus0}], 2nd [${s2Bonus1}])`;
                const opt1Text = `MAP ${s1Penalty1} (1 prior attack: 1st [${s1Bonus1}], 2nd [${s2Bonus2}])`;
                const opt2Text = `MAP ${s1Penalty2} (2+ prior attacks: 1st [${s1Bonus2}], 2nd [${s2Bonus2}])`;

                html.find("#fob-starting-map option[value='0']").text(opt0Text);
                html.find("#fob-starting-map option[value='1']").text(opt1Text);
                html.find("#fob-starting-map option[value='2']").text(opt2Text);

                const chosenStartingMap = parseInt(html.find("#fob-starting-map").val(), 10) || 0;
                const m1 = Math.min(chosenStartingMap, 2);
                const m2 = Math.min(chosenStartingMap + 1, 2);

                const b1 = chosen1.variants?.[m1]?.label ?? "+0";
                const b2 = chosen2.variants?.[m2]?.label ?? "+0";

                const p1Tag = m1 === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(chosen1, m1)}`;
                const p2Tag = `MAP ${getStrikeMapPenalty(chosen2, m2)}`;

                html.find("#fob-preview-content").html(`
                    <div style="display: flex; justify-content: space-between; gap: 8px;">
                        <span><strong>Attack 1:</strong> ${chosen1.label} (<strong>${b1}</strong>) <br><small style="color: #666;">[${p1Tag}]</small></span>
                        <span><strong>Attack 2:</strong> ${chosen2.label} (<strong>${b2}</strong>) <br><small style="color: #666;">[${p2Tag}]</small></span>
                    </div>
                `);
            };

            updateMapOptions();
            html.find("#fob-strike-1, #fob-strike-2, #fob-starting-map").on("change", updateMapOptions);
        }
    }).render(true);
}

/**
 * Calculates the MAP penalty value for a given strike and MAP index (0, 1, or 2).
 */
function getStrikeMapPenalty(strike, mapIndex) {
    if (mapIndex === 0) return 0;
    const traits = strike?.item?.system?.traits?.value ?? (strike?.item?.traits ? Array.from(strike.item.traits) : []);
    const isAgile = traits.includes("agile");
    if (mapIndex === 1) return isAgile ? -4 : -5;
    return isAgile ? -8 : -10;
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
        console.warn("PF2e Flurry of Blows | Could not reassert target", err);
    }
}

/**
 * Executes the attack rolls, confirms outcomes, rolls damages, and combines them if applicable.
 */
async function runFlurrySequence(actor, token, target, strike1, strike2, startingMap) {
    const map1Index = Math.min(startingMap, 2);
    const map2Index = Math.min(startingMap + 1, 2);

    const map1Tag = map1Index === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(strike1, map1Index)}`;
    const map2Tag = `MAP ${getStrikeMapPenalty(strike2, map2Index)}`;

    // 1. Post Flurry of Blows Header to Chat
    const targetText = target ? ` against <strong>${target.name}</strong>` : "";
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${FLURRY_OF_BLOWS_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Flurry of Blows</h3>
                </header>
                <div class="card-content">
                    <p><strong>${actor.name}</strong> unleashes a Flurry of Blows${targetText}!</p>
                </div>
            </div>
        `
    });

    // 2. Roll Attack 1
    reassertTarget(target);
    const attack1Promise = captureNextRollMessage(actor.id, "attack-roll");
    await strike1.variants[map1Index].roll({ target: target?.object ?? target });
    const attack1Msg = await attack1Promise;

    // If target was missing before, check if it was captured during Attack 1
    if (!target && attack1Msg?.target?.token?.object) {
        target = attack1Msg.target.token.object;
    }

    // Wait 1.5s to let dice settle
    await new Promise(r => setTimeout(r, 1500));

    // 3. Roll Attack 2
    reassertTarget(target);
    const attack2Promise = captureNextRollMessage(actor.id, "attack-roll");
    await strike2.variants[map2Index].roll({ target: target?.object ?? target });
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
        return "hit"; // Default if outcome not auto-determined
    };

    const detected1 = parseOutcome(attack1Msg);
    const detected2 = parseOutcome(attack2Msg);

    const strike1Summary = attack1Msg?.rolls?.[0]?.total ? ` (Total: ${attack1Msg.rolls[0].total})` : "";
    const strike2Summary = attack2Msg?.rolls?.[0]?.total ? ` (Total: ${attack2Msg.rolls[0].total})` : "";

    // 5. Outcome & Damage Confirmation Dialog
    const confirmContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; font-size: 0.95em;">Confirm the outcomes of both attacks to roll damage:</p>
            <div style="margin-bottom: 10px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 1: ${strike1.label} [${map1Tag}]${strike1Summary}</label>
                <select id="fob-outcome-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected1 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected1 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected1 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
            <div style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 2: ${strike2.label} [${map2Tag}]${strike2Summary}</label>
                <select id="fob-outcome-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected2 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected2 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected2 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
        </div>
    `;

    new Dialog({
        title: "Flurry of Blows: Confirm Hits",
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
                    const outcome1 = html.find("#fob-outcome-1").val();
                    const outcome2 = html.find("#fob-outcome-2").val();

                    await resolveFlurryDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, startingMap);
                }
            }
        },
        default: "rollDamage"
    }).render(true);
}

/**
 * Rolls damage for each hit and combines them if both attacks succeeded.
 */
async function resolveFlurryDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, startingMap = 0) {
    const hit1 = outcome1 !== "miss";
    const hit2 = outcome2 !== "miss";

    // Re-verify target from attack messages if needed
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
            console.warn("PF2e Flurry of Blows | Error rolling strike with rollArgs, falling back to default", err);
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
                        <img src="${FLURRY_OF_BLOWS_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                        <h3>Flurry of Blows</h3>
                    </header>
                    <div class="card-content">
                        <p><em>Both strikes of Flurry of Blows missed.</em></p>
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

    // Case 4: BOTH Hit (Combine damage per Flurry of Blows rules!)
    // 1. Roll Damage 1 with full context and target
    const dmg1Promise = captureNextRollMessage(actor.id, "damage-roll");
    await rollSingleStrikeDamage(strike1, outcome1, attack1Msg);
    const dmg1Msg = await dmg1Promise;

    // Pause for dice animations
    await new Promise(r => setTimeout(r, 1500));

    // 2. Roll Damage 2 with full context and target
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
            const type = fallbackStrike.item?.system?.damage?.damageType || "bludgeoning";
            combinedByType[type] = (combinedByType[type] || 0) + (roll.total ?? 0);
        }
    };

    collectDamage(roll1, strike1);
    collectDamage(roll2, strike2);

    const formulaParts = Object.entries(combinedByType).map(([type, total]) => `${total}[${type}]`);
    const combinedFormula = formulaParts.join(", ");
    const totalDamage = Object.values(combinedByType).reduce((a, b) => a + b, 0);

    const map1Index = Math.min(startingMap, 2);
    const map2Index = Math.min(startingMap + 1, 2);
    const map1Tag = map1Index === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(strike1, map1Index)}`;
    const map2Tag = `MAP ${getStrikeMapPenalty(strike2, map2Index)}`;

    const breakdown1 = `${strike1.label} (${outcome1 === "crit" ? "Critical Hit" : "Hit"}, ${map1Tag}): ${roll1?.total ?? 0}`;
    const breakdown2 = `${strike2.label} (${outcome2 === "crit" ? "Critical Hit" : "Hit"}, ${map2Tag}): ${roll2?.total ?? 0}`;

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

    const deepClone = (obj) => {
        if (!obj) return {};
        if (globalThis.foundry?.utils?.deepClone) {
            return foundry.utils.deepClone(obj);
        }
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return { ...obj };
        }
    };

    // Build flags merging PF2e damage context and module flags (like pf2e-toolbelt or pf2e-target-damage)
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
        <div style="display: flex; align-items: center; gap: 8px; margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #2e7d32; border-radius: 4px;">
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
                <img src="${FLURRY_OF_BLOWS_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                <h3>Flurry of Blows - Combined Damage</h3>
            </header>
            <div class="card-content">
                ${targetHeaderHtml}
                <p style="margin-bottom: 4px;"><strong>Combined for Resistances & Weaknesses:</strong></p>
                <p style="font-size: 0.85em; color: #444; border-left: 3px solid #990000; padding-left: 6px; background: rgba(0,0,0,0.03); margin: 0 0 6px 0;">
                    • ${breakdown1}<br>
                    • ${breakdown2}
                </p>
                <p style="font-size: 0.85em; color: #666; font-style: italic; margin: 0 0 4px 0;">
                    Total combined: <strong>${totalDamage}</strong>.
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
        console.error("PF2e Flurry of Blows | Failed to evaluate DamageRoll, using fallback", err);
    }

    // Fallback message if DamageRoll could not be instantiated
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${FLURRY_OF_BLOWS_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Flurry of Blows - Combined Damage</h3>
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
