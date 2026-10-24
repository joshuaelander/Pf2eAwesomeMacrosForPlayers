/**
 * PF2e Twin Feint Macro (Rogue)
 * 
 * Rules (Pathfinder Player Core / Remaster - Feat 1):
 * - Requirements: You are wielding two melee weapons, each in a different hand.
 * - You use an attack with one weapon to distract your foe from a second attack
 *   coming at a different angle.
 * - Make one Strike with each of your two melee weapons, both against the same target.
 * - The target is automatically off-guard against the second attack.
 * - Apply your multiple attack penalty to the Strikes normally.
 * 
 * Macro Features:
 * - Detects active token/actor (or player assigned character).
 * - Verifies the character is wielding two ready 1-handed melee weapons in different hands.
 * - Reminds the player if Twin Feint is not listed in feats (without blocking).
 * - Prompts to target an enemy and ensures both attacks hit the same target.
 * - Dynamic MAP handling: Strike 1 at starting MAP, Strike 2 at starting MAP + 1 step.
 * - Live preview of attack bonuses and MAP penalties directly in the setup dialog.
 * - Validation warning if the user attempts to choose the same weapon for both strikes.
 * - Automatically treats the target as Off-Guard for Strike 2 (+2 vs AC / -2 AC circumstance,
 *   and activates 'target:condition:off-guard' roll option so Rogue Sneak Attack triggers!).
 * - Sequential attack rolls with 3D dice animation settle timing.
 * - Interactive outcome confirmation dialog (Hit / Crit / Miss).
 * - Rolls independent damage cards for each hitting strike with full target context.
 */

export const TWIN_FEINT_MACRO_NAME = "Twin Feint";
export const TWIN_FEINT_MACRO_ICON = "icons/skills/melee/weapons-crossed-daggers-orange.webp";

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
 * Checks if a target actor is already off-guard (or flat-footed).
 */
function isTargetOffGuard(targetActor) {
    if (!targetActor) return false;
    const hasCondition = targetActor.itemTypes?.condition?.some(c => c.slug === "off-guard" || c.slug === "flat-footed");
    const hasRollOption = Boolean(targetActor.flags?.pf2e?.rollOptions?.all?.["self:condition:off-guard"] ||
                                  targetActor.flags?.pf2e?.rollOptions?.all?.["self:condition:flat-footed"]);
    return hasCondition || hasRollOption;
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
        console.warn("PF2e Twin Feint | Could not reassert target", err);
    }
}

/**
 * Main macro execution.
 */
export async function executeTwinFeint() {
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

    // Clean up any lingering Twin Feint effects from previous interrupted runs
    const lingering = actor.itemTypes?.effect?.filter(e => e.slug === "twin-feint-off-guard") ?? [];
    if (lingering.length > 0) {
        await actor.deleteEmbeddedDocuments("Item", lingering.map(e => e.id));
    }

    // 2. Identify Target
    const targets = Array.from(game.user.targets ?? []);
    let target = targets.length > 0 ? targets[0] : null;

    if (!target) {
        ui.notifications.warn("Please target an enemy token first. Twin Feint requires both attacks to target the same creature.");
    }

    // 3. Feat Check Reminder
    const hasFeat = actor.itemTypes?.feat?.some(f => 
        f.slug === "twin-feint" || 
        f.name.toLowerCase().includes("twin feint")
    );
    if (!hasFeat) {
        ui.notifications.warn(`Reminder: Twin Feint is not listed in ${actor.name}'s feats.`);
    }

    // 4. Find Available Melee Strikes (Prefer ready 1-handed melee weapons)
    let availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && isOneHandedMeleeStrike(a)) ?? [];

    // Fallback: any ready melee strike if specific one-handed check yields fewer than 2
    if (availableStrikes.length < 2) {
        availableStrikes = actor.system.actions?.filter(a => a.type === "strike" && a.ready && a.item?.isMelee) ?? [];
    }

    if (availableStrikes.length < 2) {
        return ui.notifications.error("Twin Feint requires wielding two melee weapons, each in a different hand.");
    }

    // Default: Weapon 1 is index 0, Weapon 2 is index 1
    const defaultIdx1 = 0;
    const defaultIdx2 = Math.min(1, availableStrikes.length - 1);

    // 5. Build Initial Setup Dialog
    const targetOffGuardNow = isTargetOffGuard(target?.actor);
    const targetStatusHtml = target
        ? `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(46, 125, 50, 0.08); border-left: 3px solid #2e7d32; border-radius: 3px;">
             <strong>Target:</strong> ${target.name} ${targetOffGuardNow ? '<span style="color:#2e7d32; font-weight:bold;">(Currently Off-Guard)</span>' : '<span style="color:#d32f2f;">(Will become Off-Guard for Strike 2)</span>'}
           </div>`
        : `<div style="margin-bottom: 10px; padding: 6px 10px; background: rgba(245, 124, 0, 0.08); border-left: 3px solid #f57c00; border-radius: 3px;">
             <em style="font-size: 0.9em; color: #555;">No target selected! Twin Feint requires both strikes to target the same creature.</em>
           </div>`;

    const strike1OptionsHtml = availableStrikes.map((s, idx) => {
        const selected = idx === defaultIdx1 ? "selected" : "";
        return `<option value="${idx}" ${selected}>${s.label}</option>`;
    }).join("");

    const strike2OptionsHtml = availableStrikes.map((s, idx) => {
        const selected = idx === defaultIdx2 ? "selected" : "";
        return `<option value="${idx}" ${selected}>${s.label}</option>`;
    }).join("");

    const setupDialogContent = `
        <div style="font-family: 'Signika', sans-serif;">
            ${targetStatusHtml}
            <p style="margin-top: 0; font-size: 0.95em; color: #333;">
                Make two melee Strikes against the same target. The target is <strong>automatically off-guard</strong> against the second attack!
            </p>

            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 1 (Feint Strike):</label>
                <select id="tf-strike-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strike1OptionsHtml}
                </select>
            </div>

            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 2 (Off-Guard Strike):</label>
                <select id="tf-strike-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    ${strike2OptionsHtml}
                </select>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Starting Multiple Attack Penalty (MAP):</label>
                <select id="tf-starting-map" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="0" selected>No MAP (Attack 1: No MAP | Attack 2: MAP -5 / -4)</option>
                    <option value="1">MAP (1 attack already) (Attack 1: MAP -5 / -4 | Attack 2: MAP -10 / -8)</option>
                    <option value="2">MAP (2+ attacks already) (Attack 1: MAP -10 / -8 | Attack 2: MAP -10 / -8)</option>
                </select>
            </div>

            <div id="tf-live-preview" style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px; font-size: 0.9em;">
                <!-- Updated dynamically -->
            </div>

            <div id="tf-validation-error" style="display: none; margin-bottom: 10px; padding: 6px 10px; background: rgba(211, 47, 47, 0.1); border-left: 3px solid #d32f2f; color: #d32f2f; font-weight: bold; font-size: 0.9em;">
                Twin Feint requires wielding two different weapons (one in each hand). Please select two distinct weapons.
            </div>
        </div>
    `;

    new Dialog({
        title: "Twin Feint Setup",
        content: setupDialogContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            },
            execute: {
                icon: '<i class="fas fa-dagger"></i>',
                label: "Strike!",
                callback: async (html) => {
                    const idx1 = parseInt(html.find("#tf-strike-1").val(), 10);
                    const idx2 = parseInt(html.find("#tf-strike-2").val(), 10);
                    const startingMap = parseInt(html.find("#tf-starting-map").val(), 10);

                    if (idx1 === idx2) {
                        ui.notifications.error("Twin Feint requires using two different weapons!");
                        return;
                    }

                    const selectedStrike1 = availableStrikes[idx1];
                    const selectedStrike2 = availableStrikes[idx2];

                    await rollTwinFeint(actor, token, target, selectedStrike1, selectedStrike2, startingMap);
                }
            }
        },
        default: "execute",
        render: (html) => {
            const updatePreview = () => {
                const idx1 = parseInt(html.find("#tf-strike-1").val(), 10);
                const idx2 = parseInt(html.find("#tf-strike-2").val(), 10);
                const startingMap = parseInt(html.find("#tf-starting-map").val(), 10);

                const s1 = availableStrikes[idx1];
                const s2 = availableStrikes[idx2];

                const s1MapIdx = Math.min(startingMap, 2);
                const s2MapIdx = Math.min(startingMap + 1, 2);

                const s1Bonus = s1?.variants?.[s1MapIdx]?.label ?? "+0";
                const s2Bonus = s2?.variants?.[s2MapIdx]?.label ?? "+0";

                const isSameWeapon = idx1 === idx2;
                const errorDiv = html.find("#tf-validation-error");
                const execBtn = html.closest(".dialog").find(".dialog-button.execute");

                if (isSameWeapon) {
                    errorDiv.show();
                    execBtn.prop("disabled", true).css("opacity", "0.5");
                } else {
                    errorDiv.hide();
                    execBtn.prop("disabled", false).css("opacity", "1.0");
                }

                const offGuardBonusNote = targetOffGuardNow
                    ? '<span style="color:#2e7d32;">(Target already Off-Guard)</span>'
                    : '<span style="color:#1976d2;">(Target automatically Off-Guard: -2 AC)</span>';

                const previewHtml = `
                    <div style="margin-bottom: 4px;">
                        <strong>Strike 1 (Feint):</strong> ${s1?.label ?? "Weapon 1"} (${s1Bonus})
                    </div>
                    <div>
                        <strong>Strike 2 (Follow-up):</strong> ${s2?.label ?? "Weapon 2"} (${s2Bonus}) ${offGuardBonusNote}
                    </div>
                `;
                html.find("#tf-live-preview").html(previewHtml);
            };

            html.find("#tf-strike-1").on("change", updatePreview);
            html.find("#tf-strike-2").on("change", updatePreview);
            html.find("#tf-starting-map").on("change", updatePreview);
            updatePreview();
        }
    }).render(true);
}

/**
 * Executes the sequential strikes for Twin Feint and prompts for damage.
 */
async function rollTwinFeint(actor, token, target, strike1, strike2, startingMap) {
    const s1MapIdx = Math.min(startingMap, 2);
    const s2MapIdx = Math.min(startingMap + 1, 2);

    const s1Tag = s1MapIdx === 0 ? "No MAP" : (s1MapIdx === 1 ? "MAP -5/-4" : "MAP -10/-8");
    const s2Tag = s2MapIdx === 1 ? "MAP -5/-4" : "MAP -10/-8";

    // 1. Post Twin Feint Header to Chat
    const targetText = target ? ` against <strong>${target.name}</strong>` : "";
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor, token }),
        content: `
            <div class="pf2e chat-card">
                <header class="card-header flexrow">
                    <img src="${TWIN_FEINT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                    <h3>Twin Feint</h3>
                </header>
                <div class="card-content">
                    <p><strong>${actor.name}</strong> attacks with <strong>${strike1.label}</strong> to distract their foe from a second attack coming at a different angle with <strong>${strike2.label}</strong>${targetText}!</p>
                    <p><em style="font-size: 0.85em; color: #555;">The target is automatically off-guard against the second attack.</em></p>
                </div>
            </div>
        `
    });

    // 2. Roll Strike 1 (Feint Strike)
    reassertTarget(target);
    const attack1Promise = captureNextRollMessage(actor.id, "attack-roll");
    await strike1.variants[s1MapIdx].roll({
        target: target?.object ?? target,
        extraRollOptions: ["action:twin-feint"]
    });
    const attack1Msg = await attack1Promise;

    if (!target && attack1Msg?.target?.token?.object) {
        target = attack1Msg.target.token.object;
    }

    // Wait 1.5s to let dice settle
    await new Promise(r => setTimeout(r, 1500));

    // 3. Prepare Strike 2 (Target Automatically Off-Guard)
    // If target is not already off-guard, create a temporary Mastermind-style EphemeralEffect
    // on the rogue actor so PF2e natively treats the target as Off-Guard (-2 AC & Sneak Attack).
    let tempEffectId = null;
    const targetAlreadyOffGuard = isTargetOffGuard(target?.actor);

    if (!targetAlreadyOffGuard) {
        try {
            const effectData = {
                type: "effect",
                name: `Twin Feint: Off-Guard (${target?.name ?? "Target"})`,
                img: TWIN_FEINT_MACRO_ICON,
                system: {
                    slug: "twin-feint-off-guard",
                    level: { value: 1 },
                    duration: { value: 1, unit: "rounds", expiry: "turn-end" },
                    description: {
                        value: `<p>Target is automatically off-guard against Twin Feint's second Strike.</p>`
                    },
                    rules: [
                        {
                            key: "EphemeralEffect",
                            selectors: ["strike-attack-roll", "strike-damage"],
                            uuid: "Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg"
                        }
                    ]
                }
            };
            const created = await actor.createEmbeddedDocuments("Item", [effectData]);
            tempEffectId = created?.[0]?.id ?? null;
        } catch (err) {
            console.warn("PF2e Twin Feint | Could not create ephemeral off-guard effect, falling back to roll options & modifiers", err);
        }
    }

    reassertTarget(target);
    const attack2Promise = captureNextRollMessage(actor.id, "attack-roll");

    const rollArgs2 = {
        target: target?.object ?? target,
        extraRollOptions: [
            "action:twin-feint",
            "target:condition:off-guard",
            "target:condition:flat-footed"
        ]
    };

    // Fallback: If ephemeral effect could not be created and target is not off-guard, add +2 circumstance modifier
    if (!tempEffectId && !targetAlreadyOffGuard && globalThis.game?.pf2e?.Modifier) {
        rollArgs2.modifiers = [
            new game.pf2e.Modifier({
                slug: "twin-feint-off-guard",
                label: "Twin Feint (Target Off-Guard)",
                modifier: 2,
                type: "circumstance"
            })
        ];
    }

    await strike2.variants[s2MapIdx].roll(rollArgs2);
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

    // Helper to safely clean up the temporary effect once Strike 2 damage is resolved or cancelled
    const cleanupTempEffect = async () => {
        if (tempEffectId) {
            const effectExists = actor.items.has(tempEffectId);
            if (effectExists) {
                try {
                    await actor.deleteEmbeddedDocuments("Item", [tempEffectId]);
                } catch (err) {
                    console.warn("PF2e Twin Feint | Error cleaning up ephemeral effect", err);
                }
            }
            tempEffectId = null;
        }
    };

    // 5. Outcome & Damage Confirmation Dialog
    const confirmContent = `
        <div style="font-family: 'Signika', sans-serif;">
            <p style="margin-top: 0; font-size: 0.95em;">Confirm the attack outcomes to roll damage:</p>
            <div style="margin-bottom: 10px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 1: ${strike1.label} [${s1Tag}]${strike1Summary}</label>
                <select id="tf-outcome-1" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected1 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected1 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected1 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
            </div>
            <div style="margin-bottom: 12px; padding: 8px 10px; background: rgba(0,0,0,0.04); border-radius: 4px;">
                <label style="font-weight: bold; display: block; margin-bottom: 4px;">Strike 2: ${strike2.label} [${s2Tag}] [Off-Guard]${strike2Summary}</label>
                <select id="tf-outcome-2" style="width: 100%; padding: 4px; border-radius: 4px; border: 1px solid #aaa;">
                    <option value="miss" ${detected2 === "miss" ? "selected" : ""}>Miss</option>
                    <option value="hit" ${detected2 === "hit" ? "selected" : ""}>Hit</option>
                    <option value="crit" ${detected2 === "crit" ? "selected" : ""}>Critical Hit</option>
                </select>
                <p style="margin: 4px 0 0 0; font-size: 0.85em; color: #555;">
                    <em>Note: Sneak Attack precision damage is automatically included on Strike 2 on a hit.</em>
                </p>
            </div>
        </div>
    `;

    new Dialog({
        title: "Twin Feint: Confirm Hits",
        content: confirmContent,
        buttons: {
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel",
                callback: async () => {
                    await cleanupTempEffect();
                }
            },
            rollDamage: {
                icon: '<i class="fas fa-dice-d20"></i>',
                label: "Roll Damage",
                callback: async (html) => {
                    const outcome1 = html.find("#tf-outcome-1").val();
                    const outcome2 = html.find("#tf-outcome-2").val();

                    try {
                        await resolveTwinFeintDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg);
                    } finally {
                        await cleanupTempEffect();
                    }
                }
            }
        },
        default: "rollDamage",
        close: async () => {
            await cleanupTempEffect();
        }
    }).render(true);
}

/**
 * Rolls damage for each successful strike.
 */
async function resolveTwinFeintDamage(actor, token, target, strike1, strike2, outcome1, outcome2, attack1Msg, attack2Msg) {
    const hit1 = outcome1 !== "miss";
    const hit2 = outcome2 !== "miss";

    if (!target) {
        target = attack1Msg?.target?.token?.object ?? attack2Msg?.target?.token?.object ?? null;
    }

    // Case 1: Both Missed
    if (!hit1 && !hit2) {
        return ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor, token }),
            content: `
                <div class="pf2e chat-card">
                    <header class="card-header flexrow">
                        <img src="${TWIN_FEINT_MACRO_ICON}" width="36" height="36" style="border:none; margin-right:5px;"/>
                        <h3>Twin Feint: Results</h3>
                    </header>
                    <div class="card-content">
                        <p>Both attacks missed${target ? ` <strong>${target.name}</strong>` : ""}. No damage dealt.</p>
                    </div>
                </div>
            `
        });
    }

    // Helper to roll damage with attached context
    const rollStrikeDamage = async (strike, outcome, attackMsg, isStrike2 = false) => {
        reassertTarget(target);
        const isCrit = outcome === "crit";
        const attackContext = attackMsg?.flags?.pf2e?.context ?? null;
        const targetObj = target?.object ?? target ?? null;

        const extraOptions = ["action:twin-feint"];
        if (isStrike2) {
            extraOptions.push("target:condition:off-guard", "target:condition:flat-footed");
        }

        const rollArgs = {
            checkContext: attackContext,
            target: targetObj,
            outcome: isCrit ? "criticalSuccess" : "success",
            extraRollOptions: extraOptions
        };

        try {
            if (isCrit) {
                return await strike.critical(rollArgs);
            } else {
                return await strike.damage(rollArgs);
            }
        } catch (err) {
            console.warn(`PF2e Twin Feint | Error rolling damage for ${strike.label}, falling back`, err);
            return isCrit ? await strike.critical() : await strike.damage();
        }
    };

    // Roll Strike 1 Damage if it hit
    if (hit1) {
        await rollStrikeDamage(strike1, outcome1, attack1Msg, false);
    }

    // Brief delay between damage cards for clean chat flow
    if (hit1 && hit2) {
        await new Promise(r => setTimeout(r, 600));
    }

    // Roll Strike 2 Damage if it hit (Off-Guard triggers Sneak Attack)
    if (hit2) {
        await rollStrikeDamage(strike2, outcome2, attack2Msg, true);
    }
}
