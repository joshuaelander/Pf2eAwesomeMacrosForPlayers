/**
 * Enhanced Quick Recall Knowledge Macro for PF2e
 * 
 * Features:
 * - Rolls for selected tokens or the whole party.
 * - Player view asks for specific questions (Weaknesses, Saves, etc.).
 * - GM view retrieves all information at once, plus rolls for related skills.
 * - Analyzes targeted enemies to provide contextual hints (Truths & Lies).
 * - Shares the primary d20 roll across all related skill checks.
 * - Player blind roll (All skills) if clicked with no target.
 * - Displays the Truth alongside Dubious Knowledge on failures.
 */

export const ENHANCED_RECALL_MACRO_NAME = "Enhanced Recall Knowledge";
export const ENHANCED_RECALL_MACRO_ICON = "icons/sundries/documents/blueprint-recipe-alchemical.webp";

const SKILL_DICTIONARY = { 'arcana': 'Arcana', 'crafting': 'Crafting', 'nature': 'Nature', 'occultism': 'Occultism', 'religion': 'Religion', 'society': 'Society', 'medicine': 'Medicine', 'athletics': 'Athletics', 'acrobatics': 'Acrobatics', 'stealth': 'Stealth', 'lore': 'Lore (Generic)' };

function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function calculateDegreeOfSuccess(total, dc, d20) {
    if (dc === null) return 'Unknown'; // For targetless GM rolls

    const difference = total - dc;
    let degreeValue = 0;
    if (difference >= 10) degreeValue = 3;
    else if (difference >= 0) degreeValue = 2;
    else if (difference >= -9) degreeValue = 1;
    else degreeValue = 0;

    if (d20 === 20) degreeValue = Math.min(3, degreeValue + 1);
    else if (d20 === 1) degreeValue = Math.max(0, degreeValue - 1);

    const degreeNames = ['Critical Failure', 'Failure', 'Success', 'Critical Success'];
    return degreeNames[degreeValue];
}

function calculateRKDC(targetActor) {
    if (!targetActor || targetActor.type !== 'npc') return 15;
    const level = targetActor.system?.details?.level?.value || 0;
    const rarity = targetActor.system?.traits?.rarity || 'common';

    const dcs = {
        "-1": 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22,
        7: 23, 8: 24, 9: 26, 10: 27, 11: 28, 12: 30, 13: 31, 14: 32,
        15: 34, 16: 35, 17: 36, 18: 38, 19: 39, 20: 40, 21: 42,
        22: 44, 23: 46, 24: 48, 25: 50
    };
    let dc = dcs[level] !== undefined ? dcs[level] : (14 + level * 1.3);

    if (rarity === 'uncommon') dc += 2;
    else if (rarity === 'rare') dc += 5;
    else if (rarity === 'unique') dc += 10;

    return Math.floor(dc);
}

async function analyzeCreature(targetActor) {
    if (!targetActor) return null;

    const attrs = targetActor.system?.attributes || {};
    const weaknesses = attrs.weaknesses || [];
    const resistances = attrs.resistances || [];
    const immunities = attrs.immunities || [];

    // Extract Saves
    const saves = targetActor.system?.saves || {};
    const saveMap = [
        { name: 'Fortitude', value: saves.fortitude?.value || 0 },
        { name: 'Reflex', value: saves.reflex?.value || 0 },
        { name: 'Will', value: saves.will?.value || 0 }
    ].sort((a, b) => b.value - a.value);
    const highestSave = saveMap[0]?.name || 'Unknown';
    const lowestSave = saveMap[2]?.name || 'Unknown';

    // Extract Abilities & Attacks (Filter out spells)
    const items = targetActor.items || [];
    const hasSpells = items.some(i => i.type === 'spell' || i.type === 'spellcastingEntry');
    const abilities = items.filter(i => i.type === 'action').map(i => i.name).filter(n => n && n.length > 2);
    if (hasSpells) abilities.push("can cast spells");

    const attacks = items.filter(i => i.type === 'melee' || i.type === 'weapon').map(i => i.name).filter(n => n && n.length > 2);

    const shuffledAbilities = abilities.sort(() => 0.5 - Math.random());
    const shuffledAttacks = attacks.sort(() => 0.5 - Math.random());

    const truths = {
        weaknesses: weaknesses.map(w => `${w.type} (${w.value})`),
        resistances: resistances.map(r => `${r.type} (${r.value})`),
        immunities: immunities.map(i => i.type),
        highestSave: highestSave,
        lowestSave: lowestSave,
        abilities: shuffledAbilities.slice(0, 3),
        attacks: shuffledAttacks.slice(0, 3)
    };

    const allDamageTypes = ['acid', 'bludgeoning', 'cold', 'electricity', 'fire', 'force', 'mental', 'piercing', 'poison', 'slashing', 'sonic', 'void', 'vitality', 'spirit', 'cold iron', 'silver', 'precision', 'physical'];
    const realWeaknesses = weaknesses.map(w => (w.type || '').toLowerCase());
    const realResistances = resistances.map(r => (r.type || '').toLowerCase());
    const realImmunities = immunities.map(i => (i.type || '').toLowerCase());

    const getFakeType = (realList, preferredType = null) => {
        if (preferredType && !realList.includes(preferredType)) return preferredType;
        const filtered = allDamageTypes.filter(t => !realList.includes(t));
        return filtered[Math.floor(Math.random() * filtered.length)] || 'bludgeoning';
    };

    const getOpposite = (type) => {
        const opposites = {
            'fire': 'cold', 'cold': 'fire', 'acid': 'poison', 'poison': 'acid', 'electricity': 'sonic', 'sonic': 'electricity',
            'spirit': 'physical', 'physical': 'spirit', 'mental': 'precision', 'precision': 'mental', 'cold iron': 'silver', 'silver': 'cold iron',
            'vitality': 'void', 'void': 'vitality', 'slashing': 'bludgeoning', 'bludgeoning': 'piercing', 'piercing': 'slashing', 'good': 'evil', 'evil': 'good'
        };
        return opposites[(type || '').toLowerCase()];
    };

    const getFakeHighestSave = (realHighest) => realHighest === 'Fortitude' ? 'Reflex' : (realHighest === 'Reflex' ? 'Will' : 'Fortitude');
    const getFakeLowestSave = (realLowest) => realLowest === 'Fortitude' ? 'Will' : (realLowest === 'Reflex' ? 'Fortitude' : 'Reflex');

    let baseFakeWeakness = getFakeType(realWeaknesses);
    let baseFakeImmunity = getFakeType(realImmunities);
    let baseFakeResistance = getFakeType(realResistances);

    if (weaknesses.length > 0) {
        const primary = weaknesses[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, getOpposite(primary));
        baseFakeImmunity = getFakeType(realImmunities, primary);
    } else if (resistances.length > 0) {
        const primary = resistances[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, primary);
        baseFakeResistance = getFakeType(realResistances, getOpposite(primary));
    } else if (immunities.length > 0) {
        const primary = immunities[0].type.toLowerCase();
        baseFakeWeakness = getFakeType(realWeaknesses, primary);
        baseFakeImmunity = getFakeType(realImmunities, getOpposite(primary));
    }

    let baseFakeAbility = ['Sneak Attack', 'Breath Weapon', 'Rend', 'Swallow Whole'].find(a => !truths.abilities.includes(a)) || "a special ability";
    let baseFakeAttack = ['Jaws', 'Claws', 'Tail', 'Slam'].find(a => !truths.attacks.includes(a)) || "a standard attack";
    let liesArray = [];

    if (targetActor.type === 'npc') {
        const targetTraits = (targetActor.system?.traits?.value || []).filter(t => t.toLowerCase() !== 'humanoid');
        const packs = ['pf2e.pathfinder-monster-core', 'pf2e.pathfinder-monster-core-2', 'pf2e.pathfinder-bestiary', 'pf2e.pathfinder-bestiary-2', 'pf2e.pathfinder-bestiary-3'];
        let possibleEntries = [];

        for (const packKey of packs) {
            const pack = game.packs.get(packKey);
            if (!pack) continue;
            try {
                const index = await pack.getIndex({ fields: ["system.traits.value", "system.traits.rarity", "name"] });
                for (const entry of index) {
                    if (entry.name === targetActor.name) continue;
                    const entryTraits = entry.system?.traits?.value || [];
                    const entryRarity = entry.system?.traits?.rarity || 'common';

                    let matchCount = 0;
                    for (const t of targetTraits) {
                        if (entryTraits.includes(t)) matchCount++;
                    }
                    if (matchCount > 0) possibleEntries.push({ _id: entry._id, pack: packKey, rarity: entryRarity, name: entry.name, score: matchCount });
                }
            } catch (e) {
                console.warn("Recall Knowledge | Could not search pack:", packKey);
            }
        }

        if (possibleEntries.length > 0) {
            possibleEntries.sort((a, b) => b.score - a.score);
            let topMatches = possibleEntries.slice(0, 25);
            let commons = topMatches.filter(e => e.rarity === 'common');
            let uncommons = topMatches.filter(e => e.rarity === 'uncommon');
            let pool = commons.length > 0 ? commons : (uncommons.length > 0 ? uncommons : topMatches);

            let shuffledPool = pool.sort(() => 0.5 - Math.random());
            let chosenList = shuffledPool.slice(0, 3);

            for (const chosen of chosenList) {
                let currentLie = {
                    fakeName: chosen.name,
                    fakeWeakness: baseFakeWeakness,
                    fakeImmunity: baseFakeImmunity,
                    fakeResistance: baseFakeResistance,
                    fakeAbility: baseFakeAbility,
                    fakeAttack: baseFakeAttack,
                    fakeHighSave: getFakeHighestSave(highestSave),
                    fakeLowSave: getFakeLowestSave(lowestSave)
                };

                try {
                    const fakePack = game.packs.get(chosen.pack);
                    const fakeDoc = await fakePack.getDocument(chosen._id);
                    if (fakeDoc) {
                        const fAttrs = fakeDoc.system?.attributes || {};
                        const fWeaknesses = (fAttrs.weaknesses || []).map(w => w.type.toLowerCase());
                        const fImmunities = (fAttrs.immunities || []).map(i => i.type.toLowerCase());
                        const fResistances = (fAttrs.resistances || []).map(r => r.type.toLowerCase());
                        const fItems = fakeDoc.items || [];

                        const fHasSpells = fItems.some(i => i.type === 'spell' || i.type === 'spellcastingEntry');
                        const fActions = fItems.filter(i => i.type === 'action').map(i => i.name).filter(n => n && n.length > 2);
                        if (fHasSpells) fActions.push("can cast spells");

                        const fAttacks = fItems.filter(i => i.type === 'melee' || i.type === 'weapon').map(i => i.name).filter(n => n && n.length > 2);

                        const fSaves = fakeDoc.system?.saves || {};
                        const fSaveMap = [
                            { name: 'Fortitude', value: fSaves.fortitude?.value || 0 }, { name: 'Reflex', value: fSaves.reflex?.value || 0 }, { name: 'Will', value: fSaves.will?.value || 0 }
                        ].sort((a, b) => b.value - a.value);
                        let fHigh = fSaveMap[0]?.name;
                        let fLow = fSaveMap[2]?.name;

                        if (fHigh === highestSave) fHigh = getFakeHighestSave(highestSave);
                        if (fLow === lowestSave) fLow = getFakeLowestSave(lowestSave);
                        currentLie.fakeHighSave = fHigh;
                        currentLie.fakeLowSave = fLow;

                        const validFW = fWeaknesses.filter(w => !realWeaknesses.includes(w));
                        const validFI = fImmunities.filter(i => !realImmunities.includes(i));
                        const validFR = fResistances.filter(r => !realResistances.includes(r));
                        const validFA = fActions.filter(a => !truths.abilities.includes(a));
                        const validFAttacks = fAttacks.filter(a => !truths.attacks.includes(a));

                        if (validFW.length > 0) currentLie.fakeWeakness = validFW[0];
                        if (validFI.length > 0) currentLie.fakeImmunity = validFI[0];
                        if (validFR.length > 0) currentLie.fakeResistance = validFR[0];
                        if (validFA.length > 0) currentLie.fakeAbility = validFA[Math.floor(Math.random() * validFA.length)];
                        if (validFAttacks.length > 0) currentLie.fakeAttack = validFAttacks[Math.floor(Math.random() * validFAttacks.length)];
                    }
                } catch (e) { }
                liesArray.push(currentLie);
            }
        }
    }

    if (liesArray.length === 0) {
        liesArray.push({
            fakeName: "a different creature", fakeWeakness: baseFakeWeakness, fakeImmunity: baseFakeImmunity,
            fakeResistance: baseFakeResistance, fakeAbility: baseFakeAbility, fakeAttack: baseFakeAttack,
            fakeHighSave: getFakeHighestSave(highestSave), fakeLowSave: getFakeLowestSave(lowestSave)
        });
    }

    return { truths, lies: liesArray, name: targetActor.name };
}

function getTruthString(qType, truths, otherText) {
    switch (qType) {
        case 'weaknesses': return truths.weaknesses.length ? `its weakness is ${truths.weaknesses.join(', ')}` : `it has no specific weaknesses`;
        case 'immunities': return truths.immunities.length ? `it is immune to ${truths.immunities.join(', ')}` : `it has no specific immunities`;
        case 'saves': return `its highest save is ${truths.highestSave} and lowest save is ${truths.lowestSave}`;
        case 'abilities': return truths.abilities.length ? `it has the ability: ${truths.abilities.join(', ')}` : `it has no notable special abilities`;
        case 'attacks': return truths.attacks.length ? `it attacks using its ${truths.attacks.join(', ')}` : `it uses standard attacks`;
        case 'other': return `the answer to "${otherText}" is [GM to determine based on statblock]`;
        default: return ``;
    }
}

function getLieString(qType, lie, otherText) {
    switch (qType) {
        case 'weaknesses': return `its weakness is ${lie.fakeWeakness}`;
        case 'immunities': return `it is immune to ${lie.fakeImmunity}`;
        case 'saves': return `its highest save is ${lie.fakeHighSave} and lowest save is ${lie.fakeLowSave}`;
        case 'abilities': return `it has the ability: ${lie.fakeAbility}`;
        case 'attacks': return `it attacks using its ${lie.fakeAttack}`;
        case 'other': return `the answer to "${otherText}" is [GM: Make up a lie]`;
        default: return ``;
    }
}

function getHintForDegree(degree, analysis, question, otherText) {
    if (!analysis) return "<em>No target selected.</em>";
    const { truths, lies } = analysis;

    if (question === 'all') {
        let truthsHtml = `Weaknesses: ${truths.weaknesses.join(', ') || 'None'} <br>Immunities: ${truths.immunities.join(', ') || 'None'} <br>Saves: High ${truths.highestSave} / Low ${truths.lowestSave} <br>Abilities: ${truths.abilities.join(', ') || 'None'}`;
        let liesHtml = lies.map(l => `<li style="margin-bottom:2px;"><b>${l.fakeName}:</b> Weakness: ${l.fakeWeakness}, Immunity: ${l.fakeImmunity}, High Save: ${l.fakeHighSave}, Low Save: ${l.fakeLowSave}, Ability: ${l.fakeAbility}</li>`).join('');

        if (degree === 'Critical Success') return `<span style="color:#008800;"><b>Reveal Multiple (You are sure that...):</b><br>${truthsHtml}</span>`;
        if (degree === 'Success') return `<span style="color:#0055aa;"><b>Reveal One (You think that...):</b><br>${truthsHtml}</span>`;
        if (degree === 'Failure') return `<span style="color:#aa5500;"><b>Dubious Knowledge (You think that...):</b><br><br><b>True Info:</b><br>${truthsHtml}<br><br><b>False Info:</b><ul style="margin: 4px 0; padding-left: 20px; font-size: 0.9em;">${liesHtml}</ul></span>`;
        if (degree === 'Critical Failure') return `<span style="color:#aa0000;"><b>Confident Falsehood (You are sure that...):</b><ul style="margin: 4px 0; padding-left: 20px; font-size: 0.9em;">${liesHtml}</ul></span>`;
        return "";
    }

    let truthAns = getTruthString(question, truths, otherText);

    if (degree === 'Critical Success') {
        return `<span style="color:#008800;"><b>Tell them:</b> "You are sure that ${truthAns}."<br><em>(GM: Provide additional contextual information or a second fact as appropriate!)</em></span>`;
    } else if (degree === 'Success') {
        return `<span style="color:#0055aa;"><b>Tell them:</b> "You think that ${truthAns}."</span>`;
    } else if (degree === 'Failure') {
        const optionsHtml = lies.map(l => `<li style="margin-bottom:4px;">"You think that ${getLieString(question, l, otherText)}." <br><span style="font-size:0.85em; color:#666;">(Based on ${l.fakeName})</span></li>`).join('');
        return `<span style="color:#aa5500;"><b>True Info:</b> ${truthAns}<br><br><b>Dubious Knowledge (or No Info) — Pick what to tell them:</b><ul style="margin: 4px 0; padding-left: 20px; font-size: 0.9em;">${optionsHtml}</ul></span>`;
    } else if (degree === 'Critical Failure') {
        const optionsHtml = lies.map(l => `<li style="margin-bottom:4px;">"You are sure that ${getLieString(question, l, otherText)}." <br><span style="font-size:0.85em; color:#666;">(Based on ${l.fakeName})</span></li>`).join('');
        return `<span style="color:#aa0000;"><b>Confident Falsehood — Pick what to tell them:</b><ul style="margin: 4px 0; padding-left: 20px; font-size: 0.9em;">${optionsHtml}</ul></span>`;
    }
    return "";
}

async function createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis, question, otherText, suggestedSkillLabel) {
    const colorMap = { 'Critical Success': '#00aa00', 'Success': '#0066cc', 'Failure': '#cc6600', 'Critical Failure': '#cc0000', 'Unknown': '#555555' };

    let rows = '';
    for (const res of results) {
        const p = res.primary;
        const color = colorMap[p.degree] || '#000000';

        let hintHtml = dc !== null ? getHintForDegree(p.degree, creatureAnalysis, question, otherText) : '<em>No target selected.</em>';

        let relatedHtml = '';
        if (res.related && res.related.length > 0) {
            relatedHtml = `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed #ccc; font-size: 0.85em; color: #444;">`;
            relatedHtml += `<strong>Related Skills:</strong><br>`;
            relatedHtml += res.related.map(r => {
                const rColor = colorMap[r.degree] || '#000';
                return `<span>${escapeHtml(r.label)}: <b>${r.total}</b> (${escapeHtml(r.breakdown)}) <span style="color:${rColor}; font-weight:bold;">[${r.degree}]</span></span>`;
            }).join(' <br>');
            relatedHtml += `</div>`;
        }

        rows += `
      <div class="recall-knowledge-row" style="border-left: 4px solid ${color}; padding-left:8px; margin-bottom:10px; background: rgba(0,0,0,0.03); padding-top:4px; padding-bottom:4px;">
        <div style="display:flex; justify-content: space-between; align-items: baseline;">
            <strong>${escapeHtml(res.actorName)}</strong>
            <span style="font-size: 0.9em; color:#444; margin-right: 4px;">Primary Skill</span>
        </div>
        <div style="margin-top: 2px;">
            <span>${escapeHtml(p.label)}: <b>${p.total}</b> (${escapeHtml(p.breakdown)})</span>
            &nbsp;|&nbsp;
            <span style="color:${color}; font-weight:bold; text-transform:uppercase; font-size:0.9em;">${escapeHtml(p.degree)}</span>
        </div>
        ${relatedHtml}
        <br>
        <div style="margin-top: 6px; font-size: 0.85em; font-family: 'Signika', sans-serif;">
            ${hintHtml}
        </div>
      </div>
    `;
    }

    const qLabels = { 'weaknesses': 'Weaknesses', 'immunities': 'Immunities', 'saves': 'Saves', 'abilities': 'Special Abilities', 'attacks': 'Attacks', 'other': otherText || 'Other', 'all': 'General Info' };
    const qTitle = qLabels[question] ? `<br>Asked: ${escapeHtml(qLabels[question])}` : '';

    const dcText = dc !== null ? (suggestedSkillLabel ? `${escapeHtml(suggestedSkillLabel)} DC ${dc}` : `DC ${dc}`) : `Unknown DC`;

    // Stacked title formatting
    const title = creatureName
        ? `Recall Knowledge:<br>${escapeHtml(creatureName)}<br>(${dcText})${qTitle}`
        : `Recall Knowledge<br>(${dcText})${qTitle}`;

    const content = `<div class="recall-knowledge-result" style="padding:6px; font-family: 'Signika', sans-serif;"><h4 style="border-bottom: 2px solid #333; padding-bottom: 4px;">${title}</h4>${rows}</div>`;
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

    await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: null }), content: content, whisper: gmIds, blind: true });
}

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

function getBestLore(actor) {
    const systemData = actor.system ?? actor.data?.system ?? {};
    const skills = systemData.skills ?? {};
    let best = null;
    let maxMod = -Infinity;
    for (const [key, skill] of Object.entries(skills)) {
        if (skill.lore || key.toLowerCase().includes('lore')) {
            const mod = Number(skill.mod ?? skill.value ?? skill.totalModifier ?? skill.total ?? 0);
            if (mod > maxMod) {
                maxMod = mod;
                best = { key, label: skill.label ?? key };
            }
        }
    }
    return best;
}

async function evaluateSkillRoll(actor, skillKey, dc, customLabel = null, forcedD20 = null) {
    const skillInfo = getSkillInfo(actor, skillKey);
    const skillLabel = customLabel || (skillInfo?.label ?? skillKey);
    const modifier = Number(skillInfo?.mod ?? skillInfo?.value ?? skillInfo?.totalModifier ?? skillInfo?.total ?? 0);
    const safeModifier = Number.isFinite(modifier) ? modifier : 0;

    let d20Result = forcedD20;
    let total = 0;

    if (d20Result === null) {
        const formula = `1d20 ${safeModifier >= 0 ? '+' : '-'} ${Math.abs(safeModifier)}`;
        let roll;
        try { roll = await new Roll(formula).evaluate(); }
        catch (err) { roll = { total: 0, dice: [] }; }

        try {
            const d20Term = roll.dice?.find(d => d.faces === 20);
            d20Result = d20Term?.results?.[0]?.result ?? null;
        } catch (e) { d20Result = null; }

        total = roll.total;
    } else {
        total = d20Result + safeModifier;
    }

    const degree = dc !== null ? calculateDegreeOfSuccess(total, dc, d20Result) : 'Unknown';
    const modDisplay = safeModifier >= 0 ? `+${safeModifier}` : `${safeModifier}`;
    const breakdown = d20Result !== null ? `${d20Result}${modDisplay}` : total;

    return { label: skillLabel, total: total, d20: d20Result, degree: degree, breakdown: breakdown };
}

async function performRecallKnowledge(html) {
    const skillKey = html.find('[name="skill"]').val();
    const question = html.find('[name="question"]').val() || 'all';
    const otherText = html.find('[name="otherText"]').val() || '';

    const targets = Array.from(game.user.targets ?? []);
    const hasTarget = targets.length > 0;

    const dc = hasTarget ? calculateRKDC(targets[0]?.actor) : null;
    const creatureName = hasTarget ? (targets[0]?.name ?? targets[0]?.actor?.name ?? 'Unknown Creature') : null;
    const creatureAnalysis = hasTarget ? await analyzeCreature(targets[0]?.actor) : null;

    // Determine target actors (Auto-select PC if player forgot, or whole party if GM has no tokens)
    const controlled = canvas?.tokens?.controlled ?? [];
    const isPCSelected = controlled.length > 0;
    let targetActors = [];

    if (isPCSelected) {
        const seen = new Set();
        for (const token of controlled) {
            if (token.actor && !seen.has(token.actor.id)) { targetActors.push(token.actor); seen.add(token.actor.id); }
        }
    } else {
        if (!game.user.isGM && game.user.character) {
            targetActors = [game.user.character]; // Auto-select assigned character for players
        } else if (game.actors.party) {
            targetActors = Array.from(game.actors.party.members); // GM default to Party
        } else {
            targetActors = game.actors.filter(a => a.type === 'character' && (a.system?.details?.alliance === 'party' || a.alliance === 'party'));
            if (targetActors.length === 0) targetActors = game.actors.filter(a => a.type === 'character' && a.hasPlayerOwner);
        }
    }

    if (targetActors.length === 0) {
        ui.notifications.error('No target actors found (no controlled tokens and no party actors).');
        return;
    }

    // --- Player Blind Roll (All Skills) if no target is selected ---
    if (!hasTarget && !game.user.isGM) {
        const actor = targetActors[0];

        let roll;
        try { roll = await new Roll(`1d20`).evaluate(); }
        catch (err) { ui.notifications.error("Roll error."); return; }
        const d20 = roll.dice[0].results[0].result;

        const skillPromises = Object.keys(SKILL_DICTIONARY).map(async key => {
            if (key === 'lore') {
                const best = getBestLore(actor);
                if (!best) return null;
                return await evaluateSkillRoll(actor, best.key, null, best.label, d20);
            }
            return await evaluateSkillRoll(actor, key, null, null, d20);
        });
        const allSkills = (await Promise.all(skillPromises)).filter(x => x);

        let blindHtml = `<div style="padding:6px; font-family: 'Signika', sans-serif;">
            <h4 style="border-bottom: 2px solid #333; padding-bottom: 4px;">Blind Recall Knowledge</h4>
            <p style="margin-bottom: 4px;"><strong>Actor:</strong> ${escapeHtml(actor.name)}</p>
            <p style="margin-top: 0;"><strong>Base d20 Roll:</strong> <b>${d20}</b></p>
            <ul style="list-style: none; padding-left: 0; margin-bottom: 10px;">`;

        for (let r of allSkills) {
            const mod = r.total - d20;
            blindHtml += `<li style="margin-bottom: 4px; padding: 4px; background: rgba(0,0,0,0.03); border-left: 3px solid #666;">
                <strong>${escapeHtml(r.label)}:</strong> <b>${r.total}</b> 
                <span style="font-size:0.85em; color:#555;">(Mod: ${mod >= 0 ? '+' : ''}${mod})</span>
            </li>`;
        }
        blindHtml += `</ul><p style="font-size: 0.85em; color: #444; margin-bottom: 0;"><em>No target selected.</em></p></div>`;

        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: null }), content: blindHtml, whisper: gmIds, blind: true });
        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<div class="pf2e chat-card"><header class="card-header flexrow"><h4>Recall Knowledge</h4></header><div class="card-content"><p><b>${escapeHtml(actor.name)}</b> tries to recall information about something...</p></div></div>` });
        return;
    }

    // Determine the formatted label for the target's suggested skill to pass to the chat card
    let suggestedSkillLabel = null;
    if (hasTarget) {
        const sKey = getSuggestedSkill(targets[0].actor);
        if (sKey && SKILL_DICTIONARY[sKey]) {
            suggestedSkillLabel = SKILL_DICTIONARY[sKey];
        }
    }

    const relatedMap = {
        'arcana': ['occultism', 'nature', 'lore'],
        'religion': ['occultism', 'lore'],
        'occultism': ['arcana', 'religion', 'lore'],
        'nature': ['arcana', 'lore'],
        'society': ['lore'],
        'crafting': ['nature', 'medicine', 'lore'],
        'athletics': ['acrobatics', 'lore'],
        'acrobatics': ['athletics', 'lore'],
        'stealth': ['deception', 'lore'],
        'survival': ['nature', 'lore'],
        'medicine': ['nature', 'lore'],
    };

    const rollPromises = targetActors.map(async (actor) => {
        // Roll Primary Selected Skill
        const primaryRoll = await evaluateSkillRoll(actor, skillKey, dc);
        const primaryD20 = primaryRoll.d20; // Extract the raw d20 result

        // Roll Related Skills secretly for the GM to reference using the SAME d20
        const relatedRolls = [];
        const relatedKeys = relatedMap[skillKey] || [];

        for (const relKey of relatedKeys) {
            if (relKey === 'lore') {
                const bestLore = getBestLore(actor);
                if (bestLore) relatedRolls.push(await evaluateSkillRoll(actor, bestLore.key, dc, bestLore.label, primaryD20));
            } else {
                relatedRolls.push(await evaluateSkillRoll(actor, relKey, dc, null, primaryD20));
            }
        }

        return { actorId: actor.id, actorName: actor.name, primary: primaryRoll, related: relatedRolls };
    });

    let results;
    try { results = await Promise.all(rollPromises); }
    catch (err) { ui.notifications.error('Error performing rolls.'); return; }

    await createAggregatedRecallMessage(results, dc, creatureName, creatureAnalysis, question, otherText, suggestedSkillLabel);

    if (isPCSelected || (!game.user.isGM && targetActors.length === 1)) {
        const qLabels = { 'weaknesses': 'Weaknesses', 'immunities': 'Immunities', 'saves': 'Saves', 'abilities': 'Special Abilities', 'attacks': 'Attacks', 'other': 'Specific Information', 'all': 'General Info' };
        const askedStr = game.user.isGM ? '' : ` to learn about its <b>${escapeHtml(qLabels[question])}</b>`;

        let publicContent = `<div class="pf2e chat-card"><header class="card-header flexrow"><h4>Recall Knowledge</h4></header><div class="card-content">`;
        for (const res of results) {
            publicContent += `<p style="margin-bottom: 6px;"><b>${escapeHtml(res.actorName)}</b> tries to recall information about the creature using their skill in <b>${escapeHtml(res.primary.label)}</b>${askedStr}.</p>`;
        }
        publicContent += `</div></div>`;
        await ChatMessage.create({ user: game.user.id, speaker: ChatMessage.getSpeaker(), content: publicContent });
    }
}

function getSuggestedSkill(actor) {
    if (!actor || actor.type !== 'npc') return null;
    const traits = actor.system?.traits?.value || [];
    const rkMap = { aberration: 'occultism', animal: 'nature', astral: 'occultism', beast: 'nature', celestial: 'religion', construct: 'crafting', dragon: 'arcana', elemental: 'arcana', ethereal: 'occultism', fey: 'nature', fiend: 'religion', fungus: 'nature', humanoid: 'society', monitor: 'religion', ooze: 'occultism', plant: 'nature', spirit: 'occultism', undead: 'religion' };

    for (const trait of traits) {
        if (rkMap[trait]) return rkMap[trait];
    }
    return null;
}

export function openRecallKnowledgeDialog() {
    const targets = Array.from(game.user.targets ?? []);

    // Only fetch the single direct trait match for the dropdown
    let suggestedSkill = targets.length > 0 ? getSuggestedSkill(targets[0]?.actor) : null;

    let skillOptions = '';
    for (let [key, label] of Object.entries(SKILL_DICTIONARY)) {
        const isSuggested = (key === suggestedSkill);
        skillOptions += `<option value="${escapeHtml(key)}" ${isSuggested ? 'selected' : ''}>${escapeHtml(label)}${isSuggested ? ' (Suggested)' : ''}</option>`;
    }

    const hasTarget = (targets.length > 0);
    const isGM = game.user.isGM;

    // Adjusted warning string to reflect the new No Target behavior
    const targetWarning = hasTarget
        ? `<p style="color: green;"><em><i class="fas fa-bullseye"></i> Target detected. DC and traits will be calculated secretly.</em></p>`
        : (isGM
            ? `<p style="color: #aa5500;"><em><i class="fas fa-exclamation-triangle"></i> No target. Will roll selected skill for the whole party.</em></p>`
            : `<p style="color: #aa5500;"><em><i class="fas fa-exclamation-triangle"></i> No target. Will roll a blind d20 for ALL your skills instead.</em></p>`);

    const questionHtml = !isGM ? `
      <div class="form-group">
        <label>Question:</label>
        <select id="question-select" name="question">
            <option value="weaknesses">Weaknesses</option>
            <option value="immunities">Immunities</option>
            <option value="saves">Lowest/Highest Saves</option>
            <option value="abilities">Special Abilities</option>
            <option value="attacks">Attacks</option>
            <option value="other">Other (Specify)</option>
        </select>
      </div>
      <div class="form-group" id="other-text-group" style="display:none;">
        <label>Specify:</label>
        <input type="text" id="other-text" name="otherText" placeholder="What do you want to know?" />
      </div>
    ` : `<input type="hidden" name="question" value="all" />`;

    const content = `
    <form>
      <div class="form-group"><label>Skill to Use:</label><select id="skill-select" name="skill">${skillOptions}</select></div>
      ${questionHtml}
      <hr>
      <div class="form-group" style="display:block;">
        ${targetWarning}
        <p style="font-size: 0.85em;"><em>This will roll a secret check to the GM using your currently selected token.</em></p>
      </div>
    </form>`;

    new Dialog({
        title: isGM ? 'Recall Knowledge (GM Overview)' : 'Recall Knowledge Check',
        content: content,
        buttons: {
            roll: { icon: '<i class="fas fa-brain"></i>', label: 'Secret Roll', callback: (html) => performRecallKnowledge(html) },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
        },
        default: 'roll',
        render: (html) => {
            if (!isGM) {
                html.find('#question-select').change(function () {
                    if ($(this).val() === 'other') html.find('#other-text-group').show();
                    else html.find('#other-text-group').hide();
                });
            }
        }
    }).render(true);
}