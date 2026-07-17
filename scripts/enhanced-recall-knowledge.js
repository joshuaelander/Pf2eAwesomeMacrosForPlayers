/**
 * Enhanced Recall Knowledge Macro for PF2e
 * 
 * Features:
 * - Rolls for selected tokens or the whole party.
 * - Properly calculates PF2e degrees of success (including Nat 1 / Nat 20 shifts).
 * - Analyzes targeted enemies to provide GMs with contextual hints (Truths & Lies)
 *   to handle Dubious Knowledge and Critical Failures easily.
 */

export const ENHANCED_RECALL_MACRO_NAME = "Enhanced Recall Knowledge";
export const ENHANCED_RECALL_MACRO_ICON = "icons/sundries/gaming/dice-runed-brown.webp";

/**
 * Simple HTML escape to avoid injection in chat content/options.
 */
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/**
 * Degree of success calculation using PF2e rules (+/- 10 difference and Nat 1/20 adjustments)
 */
function calculateDegreeOfSuccess(total, dc, d20) {
    const difference = total - dc;
    let degreeValue = 0; // 0: Crit Fail, 1: Fail, 2: Success, 3: Crit Success

    if (difference >= 10) degreeValue = 3;
    else if (difference >= 0) degreeValue = 2;
    else if (difference >= -9) degreeValue = 1;
    else degreeValue = 0;

    // Adjust for natural 20 and natural 1
    if (d20 === 20) {
        degreeValue = Math.min(3, degreeValue + 1);
    } else if (d20 === 1) {
        degreeValue = Math.max(0, degreeValue - 1);
    }

    const degreeNames = ['Critical Failure', 'Failure', 'Success', 'Critical Success'];
    return degreeNames[degreeValue];
}

/**
 * Calculates the appropriate standard DC for the targeted creature based on level and rarity.
 */
function calculateRKDC(targetActor) {
    if (!targetActor || targetActor.type !== 'npc') return 15;
    const level = targetActor.system?.details?.level?.value || 0;
    const rarity = targetActor.system?.traits?.rarity || 'common';
    
    // Base DC by level
    const dcs = {
        "-1": 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22,
        7: 23, 8: 24, 9: 26, 10: 27, 11: 28, 12: 30, 13: 31, 14: 32,
        15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40, 21: 42,
        22: 44, 23: 46, 24: 48, 25: 50
    };
    let dc = dcs[level] !== undefined ? dcs[level] : (14 + level * 1.3);
    
    // Rarity adjustments
    if (rarity === 'uncommon') dc += 2;
    else if (rarity === 'rare') dc += 5;
    else if (rarity === 'unique') dc += 10;
    
    return Math.floor(dc);
}

/**
 * Analyzes a target actor to extract real stats and generate plausible fake ones.
 */
async function analyzeCreature(targetActor) {
    if (!targetActor) return null;

    const attrs = targetActor.system?.attributes || {};
    const weaknesses = attrs.weaknesses || [];
    const resistances = attrs.resistances || [];
    const immunities = attrs.immunities || [];

    // Grab up to 3 notable actions or abilities
    const actions = (targetActor.items || [])
        .filter(i => i.type === 'action' || i.type === 'melee' || i.type === 'spell')
        .map(i => i.name)
        .filter(n => n && n.length > 2);
    
    // Shuffle actions to give random abilities on crits
    const shuffledActions = actions.sort(() => 0.5 - Math.random());

    const truths = {
        weaknesses: weaknesses.map(w => `${w.type} (${w.value})`),
        resistances: resistances.map(r => `${r.type} (${r.value})`),
        immunities: immunities.map(i => i.type),
        abilities: shuffledActions.slice(0, 3)
    };

    const allDamageTypes = ['acid', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'void', 'vitality'];
    
    // Arrays of actual types to avoid telling accidental truths
    const realWeaknesses = weaknesses.map(w => (w.type || '').toLowerCase());
    const realResistances = resistances.map(r => (r.type || '').toLowerCase());
    const realImmunities = immunities.map(i => (i.type || '').toLowerCase());

    // Helper to safely pick a fake type that is definitely not in the real list
    const getFakeType = (realList, preferredType = null) => {
        if (preferredType && !realList.includes(preferredType)) {
            return preferredType;
        }
        const filtered = allDamageTypes.filter(t => !realList.includes(t));
        return filtered[Math.floor(Math.random() * filtered.length)] || 'bludgeoning';
    };

    // Helper to find a logical opposite
    const getOpposite = (type) => {
        const opposites = { 
            'fire': 'cold', 'cold': 'fire', 
            'vitality': 'void', 'void': 'vitality', 
            'slashing': 'bludgeoning', 'bludgeoning': 'piercing', 'piercing': 'slashing',
            'good': 'evil', 'evil': 'good'
        };
        return opposites[(type || '').toLowerCase()];
    };

    // Generate lies based on actual data, ensuring they are strictly false
    let fakeWeakness = getFakeType(realWeaknesses);
    let fakeImmunity = getFakeType(realImmunities);
    let fakeResistance = getFakeType(realResistances);

    if (weaknesses.length > 0) {
        const primary = weaknesses[0].type.toLowerCase();
        // Fake weakness: Opposite of actual weakness (if not actually weak to it)
        fakeWeakness = getFakeType(realWeaknesses, getOpposite(primary));
        // Fake immunity: Claim they are immune to what they are actually weak to!
        fakeImmunity = getFakeType(realImmunities, primary);
    } else if (resistances.length > 0) {
        const primary = resistances[0].type.toLowerCase();
        // Fake weakness: Claim they are weak to what they actually resist
        fakeWeakness = getFakeType(realWeaknesses, primary);
        fakeResistance = getFakeType(realResistances, getOpposite(primary));
    } else if (immunities.length > 0) {
        const primary = immunities[0].type.toLowerCase();
        // Fake weakness: Claim they are weak to what they are actually immune to
        fakeWeakness = getFakeType(realWeaknesses, primary);
        fakeImmunity = getFakeType(realImmunities, getOpposite(primary));
    }

    let fakeName = "a different creature";
    if (targetActor.type === 'npc') {
        const traits = targetActor.system?.traits?.value || [];
        // Prioritize major creature types to find a matching fake creature, excluding humanoid
        const validTraits = ['undead', 'beast', 'aberration', 'animal', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'celestial', 'fungus', 'plant', 'monitor', 'ooze'];
        const mainTrait = traits.find(t => validTraits.includes(t)) || traits.find(t => t !== 'humanoid');
        
        const packs = ['pf2e.pathfinder-monster-core', 'pf2e.pathfinder-bestiary', 'pf2e.pathfinder-bestiary-2', 'pf2e.pathfinder-bestiary-3'];
        let possibleNames = [];
        
        for (const packKey of packs) {
            const pack = game.packs.get(packKey);
            if (!pack) continue;
            try {
                const index = await pack.getIndex({fields: ["system.traits.value", "name"]});
                for (const entry of index) {
                    const entryTraits = entry.system?.traits?.value || [];
                    if (mainTrait && entryTraits.includes(mainTrait) && entry.name !== targetActor.name) {
                        possibleNames.push(entry.name);
                    }
                }
            } catch (e) {
                console.warn("Recall Knowledge | Could not search pack:", packKey);
            }
            if (possibleNames.length > 50) break; // Limit search pool to avoid delays
        }
        if (possibleNames.length > 0) {
            fakeName = possibleNames[Math.floor(Math.random() * possibleNames.length)];
        }
    }

    const lies = {
        fakeWeakness,
        fakeImmunity,
        fakeResistance,
        fakeName
    };

    return { truths, lies, name: targetActor.name };
}

/**
 * Generates the GM hint text based on the degree of success and creature analysis.
 */
function getHintForDegree(degree, analysis) {
    if (!analysis) return "<em>Target an enemy to receive dynamic information hints.</em>";

    const { truths, lies } = analysis;

    let hint = "";
    if (degree === 'Critical Success') {
        const facts = [];
        if (truths.weaknesses.length) facts.push(`Weak to <b>${truths.weaknesses.join(', ')}</b>`);
        if (truths.immunities.length) facts.push(`Immune to <b>${truths.immunities.join(', ')}</b>`);
        if (truths.resistances.length) facts.push(`Resists <b>${truths.resistances.join(', ')}</b>`);
        if (truths.abilities.length) facts.push(`Notable abilities: <b>${truths.abilities.join(', ')}</b>`);
        
        hint = facts.length > 0 ? facts.join(' | ') : "No special weaknesses or resistances. Reveal a hidden trait or lore!";
        return `<span style="color:#008800;"><b>Reveal Multiple Facts:</b> ${hint}</span>`;
    
    } else if (degree === 'Success') {
        let bestFact = "Reveal a basic trait or lore.";
        if (truths.weaknesses.length) bestFact = `Reveal Weakness: <b>${truths.weaknesses[0]}</b>`;
        else if (truths.immunities.length) bestFact = `Reveal Immunity: <b>${truths.immunities[0]}</b>`;
        else if (truths.resistances.length) bestFact = `Reveal Resistance: <b>${truths.resistances[0]}</b>`;
        else if (truths.abilities.length) bestFact = `Reveal Ability: <b>${truths.abilities[0]}</b>`;
        
        return `<span style="color:#0055aa;"><b>Reveal One Fact:</b> ${bestFact}</span>`;
    
    } else if (degree === 'Failure') {
        // Provide gentle lies for Dubious Knowledge or standard failure
        return `<span style="color:#aa5500;"><b>No info (or Dubious lie):</b> Hint they might be facing <b>${lies.fakeName}</b>, suggest a fake weakness to <b>${lies.fakeWeakness}</b>, or fake resistance to <b>${lies.fakeResistance}</b>.</span>`;
    
    } else if (degree === 'Critical Failure') {
        // Bold lies
        return `<span style="color:#aa0000;"><b>Confident Lie:</b> Claim this is actually <b>${lies.fakeName}</b>! Claim it is completely immune to <b>${lies.fakeImmunity}</b>, or extremely weak to <b>${lies.fakeWeakness}</b>!</span>`;
    }

    return "";
}

/**
 * Create the secret aggregated chat message for multiple recall knowledge checks.
 */
async function createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis) {
    const colorMap = {
        'Critical Success': '#00aa00',
        'Success': '#0066cc',
        'Failure': '#cc6600',
        'Critical Failure': '#cc0000'
    };

    let rows = '';
    for (const res of results) {
        const color = colorMap[res.degree] || '#000000';
        const d20display = res.d20 !== null ? `${res.d20}` : '—';
        const modifier = res.total - (res.d20 || 0);
        const breakdown = res.d20 !== null ? `${d20display} + ${modifier}` : `${res.total}`;
        
        // Generate contextual hint
        const hintHtml = getHintForDegree(res.degree, creatureAnalysis);

        rows += `
      <div class="recall-knowledge-row" style="border-left: 4px solid ${color}; padding-left:8px; margin-bottom:10px; background: rgba(0,0,0,0.03); padding-top:4px; padding-bottom:4px;">
        <div style="display:flex; justify-content: space-between; align-items: baseline;">
            <strong>${escapeHtml(res.actorName)}</strong>
            <span style="font-size: 0.9em; color:#444;">${escapeHtml(res.skillLabel)}</span>
        </div>
        <div style="margin-top: 2px;">
            <span>Result: <b>${res.total}</b> (${escapeHtml(breakdown)})</span>
            &nbsp;|&nbsp;
            <span style="color:${color}; font-weight:bold; text-transform:uppercase; font-size:0.9em;">${escapeHtml(res.degree)}</span>
        </div>
        <div style="margin-top: 4px; font-size: 0.85em; font-family: 'Signika', sans-serif;">
            ${hintHtml}
        </div>
      </div>
    `;
    }

    const title = creatureName ? `Recall Knowledge: ${escapeHtml(creatureName)} (DC ${dc})` : `Recall Knowledge (DC ${dc})`;

    const content = `
    <div class="recall-knowledge-result" style="padding:6px; font-family: 'Signika', sans-serif;">
      <h3 style="border-bottom: 2px solid #333; padding-bottom: 4px;">${title}</h3>
      ${rows}
    </div>
  `;

    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: null }),
        content: content,
        whisper: gmIds,
        blind: true
    });

    ui.notifications.info(`Recall Knowledge checks completed for ${results.length} actor(s).`);
}

/**
 * Defensive helper to find skill data on a PF2e actor.
 */
function getSkillInfo(actor, skillKey) {
    const systemData = actor.system ?? actor.data?.system ?? {};
    const skills = systemData.skills ?? null;

    if (skills && skills[skillKey]) return skills[skillKey];

    if (skills) {
        const foundKey = Object.keys(skills).find(k => k.toLowerCase() === skillKey.toLowerCase());
        if (foundKey) return skills[foundKey];
    }
    return null;
}

/**
 * Perform recall knowledge checks for multiple actors.
 */
async function performRecallKnowledge(html) {
    const skillKey = html.find('[name="skill"]').val();

    let creatureName = "Unknown Creature";
    let creatureAnalysis = null;
    let dc = 15; // fallback
    const targets = Array.from(game.user.targets ?? []);
    
    if (targets.length === 0) {
        ui.notifications.warn('You must target an enemy to Recall Knowledge.');
        return;
    }

    const t = targets[0];
    creatureName = t?.name ?? t?.actor?.name ?? 'Unknown Creature';
    dc = calculateRKDC(t?.actor);
    creatureAnalysis = await analyzeCreature(t?.actor);

    // Determine rolling actors
    const controlled = canvas?.tokens?.controlled ?? [];
    let targetActors = [];

    if (controlled.length > 0) {
        const seen = new Set();
        for (const token of controlled) {
            if (token.actor && !seen.has(token.actor.id)) {
                targetActors.push(token.actor);
                seen.add(token.actor.id);
            }
        }
    } else {
        const actorFolders = game.folders.filter(f => f.type === 'Actor');
        const partyFolder = actorFolders.find(f => (f.name || '').toLowerCase() === 'party');

        if (partyFolder) {
            for (const actor of game.actors.values()) {
                if (actor.folder?.id === partyFolder.id) targetActors.push(actor);
            }
        }

        if (targetActors.length === 0) {
            for (const actor of game.actors.values()) {
                if (actor && (actor.type === 'character' || actor.hasPlayerOwner)) {
                    targetActors.push(actor);
                }
            }
        }
    }

    if (targetActors.length === 0) {
        ui.notifications.error('No target actors found (no controlled tokens and no party actors).');
        return;
    }

    const rollPromises = targetActors.map(async (actor) => {
        const skillInfo = getSkillInfo(actor, skillKey);
        const skillLabel = skillInfo?.label ?? skillKey;

        // Ensure we grab the total evaluated modifier for the skill
        const modifier = Number(skillInfo?.mod ?? skillInfo?.value ?? skillInfo?.totalModifier ?? skillInfo?.total ?? 0);
        const safeModifier = Number.isFinite(modifier) ? modifier : 0;
        const formula = `1d20 ${safeModifier >= 0 ? '+' : '-'} ${Math.abs(safeModifier)}`;

        let roll;
        try {
            roll = await new Roll(formula).evaluate({ async: true });
        } catch (err) {
            console.error('Recall Knowledge | Roll failed for', actor.name, err);
            roll = { total: 0, dice: [], toJSON: () => ({}) };
        }

        let d20Result = null;
        try {
            const d20Term = roll.dice?.find(d => d.faces === 20);
            d20Result = d20Term?.results?.[0]?.result ?? null;
        } catch (e) {
            d20Result = null;
        }

        const degree = calculateDegreeOfSuccess(roll.total, dc, d20Result);

        return {
            actorId: actor.id,
            actorName: actor.name,
            skillLabel: skillLabel,
            total: roll.total ?? 0,
            d20: d20Result,
            degree: degree,
            roll: roll
        };
    });

    let results;
    try {
        results = await Promise.all(rollPromises);
    } catch (err) {
        ui.notifications.error('Error performing one or more rolls.');
        return;
    }

    await createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis);
}

/**
 * Attempts to find the appropriate standard Recall Knowledge skill for a creature based on its traits.
 */
function getSuggestedSkill(actor) {
    if (!actor || actor.type !== 'npc') return null;
    const traits = actor.system?.traits?.value || [];
    
    // PF2e baseline trait to skill mappings
    const rkMap = {
        aberration: 'occultism', animal: 'nature', astral: 'occultism', beast: 'nature',
        celestial: 'religion', construct: 'crafting', dragon: 'arcana', elemental: 'arcana',
        ethereal: 'occultism', fey: 'nature', fiend: 'religion', fungus: 'nature',
        humanoid: 'society', monitor: 'religion', ooze: 'occultism', plant: 'nature',
        spirit: 'occultism', undead: 'religion'
    };

    for (const trait of traits) {
        if (rkMap[trait]) return rkMap[trait];
    }
    
    return null;
}

/**
 * Open the Recall Knowledge dialog.
 */
export function openRecallKnowledgeDialog() {
    const skills = {
        'arcana': 'Arcana', 'crafting': 'Crafting', 'nature': 'Nature',
        'occultism': 'Occultism', 'religion': 'Religion', 'society': 'Society',
        'medicine': 'Medicine', 'athletics': 'Athletics', 'acrobatics': 'Acrobatics',
        'stealth': 'Stealth', 'lore': 'Lore (Generic)'
    };

    // Determine suggested skill from target
    const targets = Array.from(game.user.targets ?? []);
    let suggestedSkill = null;
    if (targets.length > 0) {
        suggestedSkill = getSuggestedSkill(targets[0]?.actor);
    }

    let skillOptions = '';
    for (let [key, label] of Object.entries(skills)) {
        const selected = (key === suggestedSkill) ? 'selected' : '';
        const suggestedText = selected ? ' (Suggested)' : '';
        skillOptions += `<option value="${escapeHtml(key)}" ${selected}>${escapeHtml(label)}${suggestedText}</option>`;
    }

    const hasTarget = (targets.length > 0);
    const targetWarning = hasTarget 
        ? `<p style="color: green;"><em><i class="fas fa-bullseye"></i> Target detected. DC and traits will be calculated secretly.</em></p>`
        : `<p style="color: #aa5500;"><em><i class="fas fa-exclamation-triangle"></i> No enemy targeted. You must target an enemy!</em></p>`;

    const content = `
    <form>
      <div class="form-group">
        <label>Skill to Use:</label>
        <select id="skill-select" name="skill">${skillOptions}</select>
      </div>
      <hr>
      <div class="form-group" style="display:block;">
        ${targetWarning}
        <p style="font-size: 0.85em;"><em>This will roll a secret check to the GM using your currently selected token.</em></p>
      </div>
    </form>
  `;

    new Dialog({
        title: 'Recall Knowledge (Player)',
        content: content,
        buttons: {
            roll: {
                icon: '<i class="fas fa-brain"></i>',
                label: 'Secret Roll',
                callback: (html) => performRecallKnowledge(html)
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'roll'
    }).render(true);
}