/**
 * PF2e Hunted Shot Macro (Ranger)
 * 
 * Features:
 * - Detects active token/actor (or player assigned character).
 * - Verifies if Hunt Prey is active and displays a friendly reminder if not active.
 * - Filters for ready ranged weapons (preferably reload 0 such as bows).
 * - Supports separate strikes for Shot 1 and Shot 2.
 * - Dynamic Multiple Attack Penalty (MAP) progression (No MAP, MAP -5, MAP -10, or Flurry/agile penalties)
 *   pulling live attack modifiers directly from the character sheet.
 * - Live preview of attack rolls directly in the setup dialog.
 * - Rolls both shots sequentially with dice animation timing.
 * - Captures outcomes (Hit / Crit / Miss) with an interactive confirmation dialog.
 * - Rolls damage for each hit with full target and checkContext attached.
 * - Combines damage instances from both shots into a unified DamageRoll chat card
 *   so that resistances and weaknesses apply only once (per PF2e RAW).
 */

export const HUNTED_SHOT_MACRO_NAME = "Hunted Shot";
export const HUNTED_SHOT_MACRO_ICON = "icons/skills/ranged/arrow-flying-white-blue.webp";

import { OUTCOME, DEGREE, ROLL_TYPE, DEGREE_STRINGS } from "../constants.js";

/**
 * Helper to capture the next chat message of a specific type from an actor.
 */
function captureNextRollMessage(actorId, rollType, excludeId = null, timeoutMs = 120000) {
    return new Promise((resolve) => {
        const findRecent = () => game.messages?.contents?.slice(-10).reverse()
            .find(m => m.actor?.id === actorId && m.flags?.pf2e?.context?.type === rollType && (!excludeId || m.id !== excludeId)) ?? null;

        const hookId = Hooks.on("createChatMessage", (msg) => {
            if (msg.actor?.id !== actorId || (excludeId && msg.id === excludeId)) return;
            if (msg.flags?.pf2e?.context?.type === rollType) {
                Hooks.off("createChatMessage", hookId);
                resolve(msg);
            }
        });
        setTimeout(() => {
            Hooks.off("createChatMessage", hookId);
            resolve(findRecent());
        }, timeoutMs);
    });
}

/**
 * Checks if the actor or target has Hunt Prey active.
 */
function checkHuntPreyStatus(actor, target) {
    const actorHasEffect = actor.itemTypes.effect.some(e => 
        e.slug === "effect-hunt-prey" || 
        e.name === "Effect: Hunt Prey" || 
        e.name?.toLowerCase().includes("hunt prey")
    );

    const targetHasEffect = target?.actor?.itemTypes?.effect?.some(e => 
        e.slug === "effect-hunted-prey" || 
        e.name === "Effect: Hunted Prey" || 
        e.name?.toLowerCase().includes("hunted prey")
    ) ?? false;

    const rollOptions = actor.flags?.pf2e?.rollOptions?.all ?? {};
    const hasRollOption = !!(rollOptions["self:effect:hunt-prey"] || rollOptions["target:mark:hunt-prey"]);

    return actorHasEffect || targetHasEffect || hasRollOption;
}

/**
 * Calculates the MAP penalty value for a given strike and MAP index (0, 1, or 2).
 */
function getStrikeMapPenalty(strike, mapIndex) {
    if (mapIndex === 0) return 0;
    const baseBonus = parseInt(strike?.variants?.[0]?.label, 10);
    const mapBonus = parseInt(strike?.variants?.[mapIndex]?.label, 10);
    if (!isNaN(baseBonus) && !isNaN(mapBonus)) {
        return mapBonus - baseBonus;
    }
    const traits = strike?.item?.system?.traits?.value ?? (strike?.item?.traits ? Array.from(strike.item.traits) : []);
    const isAgile = traits.includes("agile");
    if (mapIndex === 1) return isAgile ? -4 : -5;
    return isAgile ? -8 : -10;
}

/**
 * Extracts the clean dice/flat formula for a persistent damage instance (e.g., "1d6", "2d4 + 2", "3").
 */
function extractPersistentFormula(inst) {
    if (!inst) return "";
    const raw = inst.head?.expression || inst.formula || (inst.total > 0 ? `${inst.total}` : "");
    const tokens = raw.replace(/\[.*?\]/g, "").match(/(\d*d\d+|\d+|[+\-*/()])/gi);
    return tokens?.join(" ").trim() || (inst.total > 0 ? `${inst.total}` : "");
}

/**
 * Calculates a numerical estimate of formula value to determine the larger persistent damage.
 */
function getFormulaAverage(formula) {
    if (!formula) return 0;
    try {
        let avg = 0;
        for (const m of formula.matchAll(/(\d+)d(\d+)/gi)) {
            avg += (parseInt(m[1], 10) || 1) * ((parseInt(m[2], 10) || 6) + 1) / 2;
        }
        for (const f of formula.replace(/\d+d\d+/gi, "").match(/\d+/g) ?? []) {
            avg += parseInt(f, 10) || 0;
        }
        return avg;
    } catch {
        return 0;
    }
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
        console.warn("PF2e Hunted Shot | Could not reassert target", err);
    }
}

/**
 * Main macro execution.
 */
export async function executeHuntedShot() {
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

    // 3. Check Hunt Prey Status
    const isHuntedPreyActive = checkHuntPreyStatus(actor, target);
    if (!isHuntedPreyActive) {
        ui.notifications.warn(`Reminder: Hunt Prey does not appear to be active on ${actor.name}.`);
    }

    // 4. Find Available Ranged Strikes (Reload 0 preferred)
    const isReloadZeroRanged = (strike) => {
        const item = strike.item;
        if (!item) return false;
        const isRanged = item.isRanged || item.system?.range > 0;
        const reload = item.system?.reload?.value;
        const isReloadZero = reload === "0" || reload === 0 || reload === "" || reload === null || reload === undefined;
        return isRanged && isReloadZero;
    };

    let availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready && isReloadZeroRanged(a)) ?? [];
    if (availableStrikes.length === 0) {
        // Fallback: any ready ranged weapon
        availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready && (a.item?.isRanged || a.item?.system?.range > 0)) ?? [];
    }

    if (availableStrikes.length === 0) {
        return ui.notifications.warn("No ready ranged weapons with reload 0 found on this character.");
    }

    // 5. Build Initial Setup Dialog
    const huntPreyStatusHtml = isHuntedPreyActive
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 3px; font-size: 0.9em;">
             <strong style="color: #2e7d32;">✓ Hunt Prey Active:</strong> Ready to unleash Hunted Shot on your prey.
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.1); border-left: 3px solid #f57c00; border-radius: 3px; font-size: 0.9em;">
             <strong style="color: #b75300;">⚠️ Hunt Prey Reminder:</strong> Hunt Prey does not appear to be active on <strong>${actor.name}</strong>. (Hunted Shot requires your target to be your designated prey).
           </div>`;

    const targetInfoHtml = target 
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 3px;">
             <strong style="color: #2e7d32;">✓ Target Selected</strong>
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.08); border-left: 3px solid #f57c00; border-radius: 3px;">
             <em style="font-size: 0.9em; color: #555;">No target selected. (Targeting your prey is recommended for automatic hit detection & damage application).</em>
           </div>`;

    const strikeOptionsHtml = availableStrikes.map((s, idx) => {
        const bonus0 = s.variants?.[0]?.label ?? "+0";
        return `<option value="${idx}">${s.label} (${bonus0})</option>`;
    }).join("");

    const setupDialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            ${huntPreyStatusHtml}
            ${targetInfoHtml}
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike for Shot 1:</label>
                <select id="hs-strike-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strikeOptionsHtml}
                </select>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike for Shot 2:</label>
                <select id="hs-strike-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strikeOptionsHtml}
                </select>
            </div>
            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Current Multiple Attack Penalty (Starting MAP):</label>
                <select id="hs-starting-map" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="0" selected>No MAP</option>
                    <option value="1">MAP -5</option>
                    <option value="2">MAP -10</option>
                </select>
            </div>
            <div id="hs-live-preview" style="margin-bottom: 12px; padding: 6px 10px; background: rgba(0, 0, 0, 0.04); border-left: 3px solid #1976d2; border-radius: 3px; font-size: 0.9em;">
                <div id="hs-preview-content"></div>
            </div>
            <p style="font-size: 0.85em; color: #555; margin: 0; font-style: italic;">
                Hunted Shot takes two quick shots with your ranged weapon, progressing MAP normally. If both hit, their damage will be combined.
            </p>
        </div>
    `;

    new Dialog({
        title: "Hunted Shot",
        content: setupDialogContent,
        buttons: {
            cancel: {
                label: "Cancel"
            },
            roll: {
                label: "Hunted Shot",
                callback: async (html) => {
                    const strike1Idx = parseInt(html.find("#hs-strike-1").val(), 10) || 0;
                    const strike2Idx = parseInt(html.find("#hs-strike-2").val(), 10) || 0;
                    const startingMap = parseInt(html.find("#hs-starting-map").val(), 10) || 0;

                    // Re-check target in case user targeted an enemy while dialog was open
                    if (!target && game.user.targets?.size > 0) {
                        target = Array.from(game.user.targets)[0];
                    }

                    const chosenStrike1 = availableStrikes[strike1Idx] || availableStrikes[0];
                    const chosenStrike2 = availableStrikes[strike2Idx] || availableStrikes[0];

                    await runHuntedShotSequence(actor, token, target, chosenStrike1, chosenStrike2, startingMap);
                }
            }
        },
        default: "roll",
        render: (html) => {
            const updateMapOptions = () => {
                const s1Idx = parseInt(html.find("#hs-strike-1").val(), 10) || 0;
                const s2Idx = parseInt(html.find("#hs-strike-2").val(), 10) || 0;
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

                html.find("#hs-starting-map option[value='0']").text(opt0Text);
                html.find("#hs-starting-map option[value='1']").text(opt1Text);
                html.find("#hs-starting-map option[value='2']").text(opt2Text);

                const chosenStartingMap = parseInt(html.find("#hs-starting-map").val(), 10) || 0;
                const m1 = Math.min(chosenStartingMap, 2);
                const m2 = Math.min(chosenStartingMap + 1, 2);

                const b1 = chosen1.variants?.[m1]?.label ?? "+0";
                const b2 = chosen2.variants?.[m2]?.label ?? "+0";

                const p1Tag = m1 === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(chosen1, m1)}`;
                const p2Tag = `MAP ${getStrikeMapPenalty(chosen2, m2)}`;

                html.find("#hs-preview-content").html(`
                    <div style="display: flex; justify-content: space-between; gap: 8px;">
                        <span><strong>Shot 1:</strong> ${chosen1.label} (<strong>${b1}</strong>) <br><small style="color: #666;">[${p1Tag}]</small></span>
                        <span><strong>Shot 2:</strong> ${chosen2.label} (<strong>${b2}</strong>) <br><small style="color: #666;">[${p2Tag}]</small></span>
                    </div>
                `);
            };

            updateMapOptions();
            html.find("#hs-strike-1, #hs-strike-2, #hs-starting-map").on("change", updateMapOptions);
        }
    }).render(true);
}

/**
 * Executes the attack rolls, confirms outcomes, rolls damages, and combines them if applicable.
 */
async function runHuntedShotSequence(actor, token, target, strike1, strike2, startingMap) {
    const map1Index = Math.min(startingMap, 2);
    const map2Index = Math.min(startingMap + 1, 2);

    const map1Tag = map1Index === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(strike1, map1Index)}`;
    const map2Tag = `MAP ${getStrikeMapPenalty(strike2, map2Index)}`;

    // 1. Post Hunted Shot Header to Chat
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${HUNTED_SHOT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Hunted Shot</h3>
                </header>
                <div class="card-content">
                    <p><strong>${actor.name}</strong> takes two quick shots!</p>
                </div>
            </div>
        `
    });

    // 2. Roll Shot 1
    reassertTarget(target);
    const attack1Promise = captureNextRollMessage(actor.id, ROLL_TYPE.ATTACK);
    await strike1.variants[map1Index].roll({ target: target?.object ?? target });
    const attack1Msg = await attack1Promise;

    if (!target && attack1Msg?.target?.token?.object) {
        target = attack1Msg.target.token.object;
    }

    // Wait 1.5s to let dice settle
    await new Promise(r => setTimeout(r, 1500));

    // 3. Roll Shot 2
    reassertTarget(target);
    const attack2Promise = captureNextRollMessage(actor.id, ROLL_TYPE.ATTACK, attack1Msg?.id);
    await strike2.variants[map2Index].roll({ target: target?.object ?? target });
    const attack2Msg = await attack2Promise;

    if (!target && attack2Msg?.target?.token?.object) {
        target = attack2Msg.target.token.object;
    }

    // Wait 1.2s to let dice settle
    await new Promise(r => setTimeout(r, 1200));

    // 4. Parse detected outcomes
    const parseOutcome = (msg) => {
        if (!msg) return OUTCOME.HIT;
        const liveMsg = (msg.id ? game.messages.get(msg.id) : null) ?? msg;

        // 1. Check live message content / HTML
        const content = (liveMsg.content || "") + (liveMsg.flavor || "");
        if (DEGREE_STRINGS.CRIT.some(s => content.includes(s))) return OUTCOME.CRIT;
        if (DEGREE_STRINGS.MISS.some(s => content.includes(s))) return OUTCOME.MISS;

        // 2. Check pf2e context outcome
        const contextOutcome = liveMsg.flags?.pf2e?.context?.outcome;
        if (contextOutcome === DEGREE.CRITICAL_SUCCESS) return OUTCOME.CRIT;
        if (contextOutcome === DEGREE.SUCCESS) return OUTCOME.HIT;
        if (contextOutcome === DEGREE.FAILURE || contextOutcome === DEGREE.CRITICAL_FAILURE) return OUTCOME.MISS;

        // 3. Check pf2e-toolbelt targetHelper flags if present
        const toolbeltTargets = liveMsg.flags?.["pf2e-toolbelt"]?.targetHelper?.targets 
            ?? liveMsg.flags?.["pf2e-toolbelt"]?.targets;
        if (toolbeltTargets && typeof toolbeltTargets === "object") {
            for (const tData of Object.values(toolbeltTargets)) {
                const deg = tData?.degree ?? tData?.result ?? tData?.outcome;
                if (deg === DEGREE.CRITICAL_SUCCESS || deg === 3 || deg === OUTCOME.CRIT) return OUTCOME.CRIT;
                if (deg === DEGREE.SUCCESS || deg === 2 || deg === OUTCOME.HIT) return OUTCOME.HIT;
                if (deg === DEGREE.FAILURE || deg === DEGREE.CRITICAL_FAILURE || deg === 1 || deg === 0) return OUTCOME.MISS;
            }
        }

        // 4. Mathematical verification against target AC
        const total = liveMsg.rolls?.[0]?.total;
        const targetActor = target?.actor;
        const baseAc = targetActor?.attributes?.ac?.value ?? targetActor?.system?.attributes?.ac?.value;
        if (typeof total === "number" && typeof baseAc === "number") {
            let degree = total >= baseAc + 10 ? 3 : (total >= baseAc ? 2 : (total <= baseAc - 10 ? 0 : 1));
            const d20 = liveMsg.rolls[0].dice?.find(d => d.faces === 20)?.results?.find(r => r.active)?.result;
            if (d20 === 20) degree = Math.min(3, degree + 1);
            else if (d20 === 1) degree = Math.max(0, degree - 1);

            return degree === 3 ? OUTCOME.CRIT : (degree === 2 ? OUTCOME.HIT : OUTCOME.MISS);
        }

        return OUTCOME.HIT;
    };

    const detected1 = parseOutcome(attack1Msg);
    const detected2 = parseOutcome(attack2Msg);

    const strike1Summary = attack1Msg?.rolls?.[0]?.total ? ` (Total: ${attack1Msg.rolls[0].total})` : "";
    const strike2Summary = attack2Msg?.rolls?.[0]?.total ? ` (Total: ${attack2Msg.rolls[0].total})` : "";

    // 5. Outcome & Damage Confirmation Dialog
    const confirmContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; font-size: 0.95em;">Confirm the outcomes of both shots to roll damage:</p>
            <div style="margin-bottom: 10px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Shot 1: ${strike1.label} [${map1Tag}]${strike1Summary}</label>
                <select id="hs-outcome-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="${OUTCOME.MISS}" ${detected1 === OUTCOME.MISS ? "selected" : ""}>Miss</option>
                    <option value="${OUTCOME.HIT}" ${detected1 === OUTCOME.HIT ? "selected" : ""}>Hit</option>
                    <option value="${OUTCOME.CRIT}" ${detected1 === OUTCOME.CRIT ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
            <div style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Shot 2: ${strike2.label} [${map2Tag}]${strike2Summary}</label>
                <select id="hs-outcome-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="${OUTCOME.MISS}" ${detected2 === OUTCOME.MISS ? "selected" : ""}>Miss</option>
                    <option value="${OUTCOME.HIT}" ${detected2 === OUTCOME.HIT ? "selected" : ""}>Hit</option>
                    <option value="${OUTCOME.CRIT}" ${detected2 === OUTCOME.CRIT ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
        </div>
    `;

    new Dialog({
        title: "Hunted Shot: Confirm Hits",
        content: confirmContent,
        buttons: {
            cancel: {
                label: "Cancel"
            },
            rollDamage: {
                label: "Roll Damage",
                callback: async (html) => {
                    const outcome1 = html.find("#hs-outcome-1").val();
                    const outcome2 = html.find("#hs-outcome-2").val();

                    await resolveHuntedShotDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, startingMap);
                }
            }
        },
        default: "rollDamage"
    }).render(true);
}

/**
 * Rolls damage for each hit and combines them if both attacks succeeded.
 */
async function resolveHuntedShotDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg, startingMap = 0) {
    const hit1 = outcome1 !== OUTCOME.MISS;
    const hit2 = outcome2 !== OUTCOME.MISS;

    if (!target) {
        target = attack1Msg?.target?.token?.object ?? attack2Msg?.target?.token?.object ?? null;
    }

    // Helper to execute single strike damage with full attack context and target passed
    const rollSingleStrikeDamage = async (strike, outcome, attackMsg) => {
        reassertTarget(target);
        const isCrit = outcome === OUTCOME.CRIT;
        const attackContext = attackMsg?.flags?.pf2e?.context ? deepClone(attackMsg.flags.pf2e.context) : null;
        if (attackContext) {
            attackContext.skipDialog = true;
        }
        const rollArgs = {
            checkContext: attackContext,
            target: target?.object ?? target ?? null,
            outcome: isCrit ? DEGREE.CRITICAL_SUCCESS : DEGREE.SUCCESS,
            skipDialog: true,
            event: { shiftKey: !!globalThis.game?.user?.settings?.showDamageDialogs, ctrlKey: false, metaKey: false }
        };

        const method = isCrit ? strike.critical : strike.damage;
        try {
            return await method.call(strike, rollArgs);
        } catch (err) {
            console.warn(`PF2e Hunted Shot | Error rolling damage for ${strike.label}`, err);
            return await method.call(strike, { skipDialog: true, event: rollArgs.event });
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
                        <img src="${HUNTED_SHOT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                        <h3>Hunted Shot</h3>
                    </header>
                    <div class="card-content">
                        <p><em>Both shots of Hunted Shot missed.</em></p>
                    </div>
                </div>
            `
        });
    }

    // Case 2: Only Shot 1 Hit
    if (hit1 && !hit2) {
        await rollSingleStrikeDamage(strike1, outcome1, attack1Msg);
        return;
    }

    // Case 3: Only Shot 2 Hit
    if (!hit1 && hit2) {
        await rollSingleStrikeDamage(strike2, outcome2, attack2Msg);
        return;
    }

    // Case 4: BOTH Hit (Combine damage per Hunted Shot rules!)
    // 1. Roll Damage 1 with full context and target
    const dmg1Promise = captureNextRollMessage(actor.id, ROLL_TYPE.DAMAGE);
    await rollSingleStrikeDamage(strike1, outcome1, attack1Msg);
    const dmg1Msg = await dmg1Promise;

    // Pause for dice animations
    await new Promise(r => setTimeout(r, 1500));

    // 2. Roll Damage 2 with full context and target
    const dmg2Promise = captureNextRollMessage(actor.id, ROLL_TYPE.DAMAGE, dmg1Msg?.id);
    await rollSingleStrikeDamage(strike2, outcome2, attack2Msg);
    const dmg2Msg = await dmg2Promise;

    // Pause for dice animations
    await new Promise(r => setTimeout(r, 1200));

    // 3. Extract and combine damage instances
    const roll1 = dmg1Msg?.rolls?.[0];
    const roll2 = dmg2Msg?.rolls?.[0];

    const directByType = {};
    const persistentByType = {};

    const collectDamage = (roll, fallbackStrike) => {
        if (!roll) return;
        if (roll.instances && roll.instances.length > 0) {
            for (const inst of roll.instances) {
                if (inst.persistent) {
                    const formula = extractPersistentFormula(inst);
                    if (!formula) continue;
                    const type = inst.type || "bleed";
                    const avg = typeof inst.expectedValue === "number" ? inst.expectedValue : getFormulaAverage(formula);
                    if (!persistentByType[type] || avg > getFormulaAverage(persistentByType[type])) {
                        persistentByType[type] = formula;
                    }
                } else {
                    const type = inst.type || "untyped";
                    directByType[type] = (directByType[type] || 0) + (inst.total ?? 0);
                }
            }
        } else {
            const type = fallbackStrike.item?.system?.damage?.damageType || "piercing";
            directByType[type] = (directByType[type] || 0) + (roll.total ?? 0);
        }
    };

    collectDamage(roll1, strike1);
    collectDamage(roll2, strike2);

    const formulaParts = [];
    for (const [type, total] of Object.entries(directByType)) {
        if (total > 0) formulaParts.push(`${total}[${type}]`);
    }
    for (const [type, formula] of Object.entries(persistentByType)) {
        formulaParts.push(`${formula}[${type},persistent]`);
    }

    const combinedFormula = formulaParts.join(", ");
    const totalDamage = Object.values(directByType).reduce((a, b) => a + b, 0);

    const map1Index = Math.min(startingMap, 2);
    const map2Index = Math.min(startingMap + 1, 2);
    const map1Tag = map1Index === 0 ? "No MAP" : `MAP ${getStrikeMapPenalty(strike1, map1Index)}`;
    const map2Tag = `MAP ${getStrikeMapPenalty(strike2, map2Index)}`;

    const formatRollBreakdown = (strike, outcome, tag, roll) => {
        const directTotal = roll?.total ?? 0;
        const outcomeLabel = outcome === OUTCOME.CRIT ? "Critical Hit" : "Hit";
        let text = `${strike.label} (${outcomeLabel}, ${tag}): ${directTotal}`;
        const persistentInstances = roll?.instances?.filter(i => i.persistent) ?? [];
        if (persistentInstances.length > 0) {
            const pStrings = persistentInstances
                .map(i => {
                    const formula = extractPersistentFormula(i);
                    return formula ? `${formula} persistent ${i.type}` : null;
                })
                .filter(Boolean);
            if (pStrings.length > 0) {
                text += ` (+ ${pStrings.join(", ")})`;
            }
        }
        return text;
    };

    const breakdown1 = formatRollBreakdown(strike1, outcome1, map1Tag, roll1);
    const breakdown2 = formatRollBreakdown(strike2, outcome2, map2Tag, roll2);

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

    // Build flags merging PF2e damage context and module flags
    const combinedFlags = deepClone(dmg1Msg?.flags ?? {});
    combinedFlags.pf2e = combinedFlags.pf2e || {};
    combinedFlags.pf2e.context = {
        ...(dmg1Msg?.flags?.pf2e?.context ?? attack1Msg?.flags?.pf2e?.context ?? {}),
        type: ROLL_TYPE.DAMAGE,
        sourceType: "attack",
        actor: actor.id,
        target: targetData,
        domains: [ROLL_TYPE.DAMAGE, "strike-damage"]
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

    const persistentSummary = Object.keys(persistentByType).length > 0
        ? ` (+ ${Object.entries(persistentByType).map(([t, f]) => `${f} persistent ${t}`).join(", ")})`
        : "";

    const cardFlavorHtml = `
        <div class="pf2e chat-card">
            <header class="card-header flexrow">
                <img src="${HUNTED_SHOT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                <h3>Hunted Shot - Combined Damage</h3>
            </header>
            <div class="card-content">
                <p style="margin-bottom: 4px;"><strong>Combined for Resistances & Weaknesses:</strong></p>
                <p style="font-size: 0.85em; color: #444; border-left: 3px solid #990000; padding-left: 6px; background: rgba(0,0,0,0.03); margin: 0 0 6px 0;">
                    • ${breakdown1}<br>
                    • ${breakdown2}
                </p>
                <p style="font-size: 0.85em; color: #666; font-style: italic; margin: 0 0 4px 0;">
                    Total combined: <strong>${totalDamage}</strong>${persistentSummary}.
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
        console.error("PF2e Hunted Shot | Failed to evaluate DamageRoll, using fallback", err);
    }

    // Fallback message if DamageRoll could not be instantiated
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${HUNTED_SHOT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Hunted Shot - Combined Damage</h3>
                </header>
                <div class="card-content">
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
